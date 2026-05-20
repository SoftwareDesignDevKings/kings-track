(function () {
  if (typeof self.browser !== 'undefined') {
    return
  }

  function promisify(namespace, method) {
    return (...args) => new Promise((resolve, reject) => {
      try {
        namespace[method](...args, result => {
          const error = self.chrome.runtime && self.chrome.runtime.lastError
          if (error) {
            reject(new Error(error.message))
            return
          }
          resolve(result)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  const browser = {
    action: self.chrome.action,
    identity: {
      getRedirectURL: path => self.chrome.identity.getRedirectURL(path),
      launchWebAuthFlow: promisify(self.chrome.identity, 'launchWebAuthFlow'),
    },
    runtime: {
      ...self.chrome.runtime,
      sendMessage: promisify(self.chrome.runtime, 'sendMessage'),
      onMessage: self.chrome.runtime.onMessage,
    },
    storage: {
      local: {
        get: promisify(self.chrome.storage.local, 'get'),
        set: promisify(self.chrome.storage.local, 'set'),
        remove: promisify(self.chrome.storage.local, 'remove'),
      },
    },
    tabs: {
      query: promisify(self.chrome.tabs, 'query'),
      sendMessage: promisify(self.chrome.tabs, 'sendMessage'),
    },
  }

  self.browser = browser
})()
