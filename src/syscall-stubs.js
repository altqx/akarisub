// Syscall stubs for FILESYSTEM=0 with fontconfig
// These provide minimal implementations that allow fontconfig to initialize
// without a real filesystem

addToLibrary({
  $SYSCALLS__deps: [],
  $SYSCALLS__postset: `
    SYSCALLS.calculateAt = function(dirfd, path) {
      return path;
    };
    SYSCALLS.doAccess = function(path, amode) {
      return -2; // ENOENT
    };
    SYSCALLS.doMkdir = function(path, mode) {
      return -30; // EROFS  
    };
    SYSCALLS.doReadlink = function(path, buf, bufsize) {
      return -2; // ENOENT
    };
    SYSCALLS.doReadv = function(stream, iov, iovcnt, offset) {
      return 0;
    };
    SYSCALLS.getStreamFromFD = function(fd) {
      if (fd === 1 || fd === 2) return { fd: fd };
      return null;
    };
  `,
  $SYSCALLS: {
    buffers: [null, [], []],
    printChar(stream, curr) {
      var buffer = SYSCALLS.buffers[stream];
      if (curr === 0 || curr === 10) {
        (stream === 1 ? out : err)(UTF8ArrayToString(buffer, 0));
        buffer.length = 0;
      } else {
        buffer.push(curr);
      }
    },
    varargs: undefined,
    get() {
      SYSCALLS.varargs += 4;
      var ret = HEAP32[(SYSCALLS.varargs - 4) >> 2];
      return ret;
    },
    getStr(ptr) {
      var ret = UTF8ToString(ptr);
      return ret;
    },
    get64(low, high) {
      return low;
    },
  }
});
