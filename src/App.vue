<template>
  <div class="container">
    <div class="upload-box">
      <input
        id="upload"
        type="file"
        :disabled="status !== Status.wait"
        @change="handleFileChange"
      />
      <el-button @click="handleUpload" :disabled="uploadDisabled"
        >上传至服务端</el-button
      >
      <el-button @click="handleResume" v-if="status === Status.pause"
        >恢复</el-button
      >
      <el-button
        v-else
        :disabled="status !== Status.uploading || !container.hash"
        @click="handlePause"
        >暂停</el-button
      >
    </div>
    <div>
      <div>文件分片进度</div>
      <el-progress :percentage="hashPercentage"></el-progress>
      <div>上传进度</div>
      <el-progress :percentage="fakeUploadPercentage"></el-progress>
    </div>
    <el-table :data="data">
      <el-table-column
        prop="hash"
        label="切片名称"
        align="center"
      ></el-table-column>
      <el-table-column label="进度" align="center">
        <template v-slot="{ row }">
          <el-progress
            :percentage="row.percentage"
            color="#909399"
          ></el-progress>
        </template>
      </el-table-column>
      <el-table-column label="切片大小(KB)" align="center" width="120">
        <template v-slot="{ row }">
          {{ row.size | transformByte }}
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script>
const SIZE = 10 * 1024 * 1024; // 切片大小

const Status = {
  wait: "wait",
  pause: "pause",
  uploading: "uploading",
};

export default {
  name: "app",
  filters: {
    transformByte(val) {
      return Number((val / 1024).toFixed(0));
    },
  },
  data: () => ({
    Status,
    container: {
      file: null,
      hash: "",
      worker: null,
    },
    hashPercentage: 0,
    data: [],
    requestList: [],
    status: Status.wait,
    fakeUploadPercentage: 0,
  }),
  computed: {
    uploadDisabled() {
      return (
        !this.container.file ||
        [Status.pause, Status.uploading].includes(this.status)
      );
    },
    uploadPercentage() {
      if (!this.container.file || !this.data.length) return 0;
      const loaded = this.data
        .map((item) => item.size * item.percentage)
        .reduce((acc, cur) => acc + cur);
      return parseInt((loaded / this.container.file.size).toFixed(2));
    },
  },
  watch: {
    uploadPercentage(now) {
      if (now > this.fakeUploadPercentage) {
        this.fakeUploadPercentage = now;
      }
    },
  },
  methods: {
    handlePause() {
      this.status = Status.pause;
      this.resetData();
    },
    resetData() {
      this.requestList.forEach((xhr) => xhr?.abort());
      this.requestList = [];
      if (this.container.worker) {
        this.container.worker.onmessage = null;
      }
    },
    async handleResume() {
      this.status = Status.uploading;
      const { uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      );
      await this.uploadChunks(uploadedList);
    },
    *uploadGen(list, num = 10) {
      const needGen = num < list.length;
      if (needGen) {
        let cursor = num - 1;
        const self = this;
        // eslint-disable-next-line no-inner-declarations
        function* uploadNext() {
          while (cursor < list.length - 1) {
            cursor++;
            yield self.request(list[cursor]);
          }
        }
        yield new Promise(async (resolve) => {
          const it = uploadNext();
          list.slice(0, num).forEach(async (option) => {
            await this.request(option);
            let finished = false;
            do {
              const a = it.next();
              finished = a.done;
              await a.value;
            } while (!finished);
            if (finished) {
              resolve();
            }
          });
        });
      } else {
        yield Promise.all(list.map((options) => this.request(options)));
      }
    },
    // xhr
    request({
      url,
      method = "post",
      data,
      headers = {},
      onProgress = (e) => e,
      requestList,
    }) {
      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = onProgress;
        xhr.open(method, url, true);
        Object.keys(headers).forEach((key) =>
          xhr.setRequestHeader(key, headers[key])
        );
        xhr.send(data);
        xhr.onload = (e) => {
          if (requestList) {
            const xhrIndex = requestList.findIndex((item) => item === xhr);
            requestList.splice(xhrIndex, 1);
          }
          resolve({
            data: e.target.response,
          });
        };
        requestList?.push(xhr);
      });
    },
    // 文件切片
    createFileChunk(file, size = SIZE) {
      const fileChunkList = [];
      let cur = 0;
      while (cur < file.size) {
        fileChunkList.push({ file: file.slice(cur, cur + size) });
        cur += size;
      }
      return fileChunkList;
    },
    // 计算文件分片信息
    calculateHash(fileChunkList) {
      return new Promise((resolve) => {
        // 利用web worker形式去写文件分片hash
        this.container.worker = new Worker("/hash.js");
        this.container.worker.postMessage({ fileChunkList });
        this.container.worker.onmessage = (e) => {
          const { percentage, hash } = e.data;
          this.hashPercentage = percentage;
          if (hash) {
            resolve(hash);
          }
        };
      });
    },
    handleFileChange(e) {
      const [file] = e.target.files;
      if (!file) return;
      // 重置所有file数据
      this.resetData();
      // 重置vue data
      Object.assign(this.$data, this.$options.data());
      this.container.file = file;
    },
    async handleUpload() {
      if (!this.container.file) return;
      this.status = Status.uploading;
      // 进行文件切片
      const fileChunkList = this.createFileChunk(this.container.file);
      // 计算每个切片的hash
      this.container.hash = await this.calculateHash(fileChunkList);

      // 针对整个文件的hash校验
      const { shouldUpload, uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      );

      // 如果已经上传过择返回成功
      if (!shouldUpload) {
        this.$message.success("秒传：上传成功");
        this.status = Status.wait;
        return;
      }

      this.data = fileChunkList.map(({ file }, index) => ({
        fileHash: this.container.hash,
        index,
        hash: this.container.hash + "-" + index,
        chunk: file,
        size: file.size,
        percentage: uploadedList.includes(index) ? 100 : 0,
      }));

      await this.uploadChunks(uploadedList);
    },
    // 上传切片，同时过滤已上传的切片
    async uploadChunks(uploadedList = []) {
      const requestList = this.data
        .filter(({ hash }) => !uploadedList.includes(hash))
        .map(({ chunk, hash, index }) => {
          const formData = new FormData();
          formData.append("file", chunk);
          formData.append("hash", hash);
          formData.append("filename", this.container.file.name);
          formData.append("fileHash", this.container.hash);
          return { formData, index };
        })
        .map(({ formData, index }) => {
          return {
            url:
              //  "http://localhost:3000/uploads"//解决跨域
              "/uploads",
            data: formData,
            onProgress: this.createProgressHandler(this.data[index]),
            requestList: this.requestList,
          };
        });
      const request = this.uploadGen(requestList, 3);
      let finished = false;
      do {
        const a = request.next();
        finished = a.done;
        await a.value;
      } while (!finished);
      if (uploadedList.length + requestList.length === this.data.length) {
        await this.mergeRequest();
      }
    },
    // 通知服务端合并切片
    async mergeRequest() {
      await this.request({
        url:
          // "http://localhost:3000/merge"
          "/merge",
        headers: {
          "content-type": "application/json",
        },
        data: JSON.stringify({
          size: SIZE,
          fileHash: this.container.hash,
          filename: this.container.file.name,
        }),
      });
      this.$message.success("上传成功");
      this.status = Status.wait;
    },
    async verifyUpload(filename, fileHash) {
      const { data } = await this.request({
        url:
          //  "http://localhost:3000/verify"
          "/verify",
        headers: {
          "content-type": "application/json",
        },
        data: JSON.stringify({
          filename,
          fileHash,
        }),
      });
      return JSON.parse(data);
    },
    createProgressHandler(item) {
      return (e) => {
        item.percentage = parseInt(String((e.loaded / e.total) * 100));
      };
    },
  },
};
</script>
