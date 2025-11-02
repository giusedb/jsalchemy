import utils from './utils.js'

import storage from './storage.js'

class JSAlchemyWsConnection {
  constructor(connection, connectionString) {
    this.connection = connection
    this.connectionString = connectionString
    this.init()
  }

  init() {
    const ws = (this.ws = new WebSocket(this.connectionString))
    ws.onmessage = async evt => {
      let data = evt.data;
      if (data.constructor === Blob) {
        data = await data.text()
      }
      this.connection.emit('ws-data', data)
    }
    ws.onopen = evt => { this.connection.emit('ws-open', evt) }
    ws.onclose = evt => { this.connection.emit('ws-close', evt) }
    ws.onerror = evt => { this.connection.emit('ws-error', evt) }
  }
}

class JSAlchemyConnection {
  constructor(resMan, endPoint, autologin) {
    const events = resMan.events;
    this.resMan = resMan;
    this.endPoint = endPoint.endsWith('/') ? endPoint : endPoint + '/'
    this.on = events.on.bind(events)
    this.unbind = events.unbind.bind(events)
    this.emit = events.emit.bind(events)
    this.once = events.once.bind(events)
    this.status = {}
    this.isConnected = false
    this.isLoggedIn = false
    this.modelWaiting = {}
    this.wsConnection = null
    if (resMan.orm.keepSession) {
      this.autoLogin(resMan.orm.keepSession)
    }

    this.on('ws-open', (evt) => {
      evt.target.send('TOKEN:' + this.status.token)
    }, this);

    this.on('ws-data', this.resMan.gotData, this.resMan)
  }

  autoLogin(ttl) {
    if (storage.has('turbineId')) {
      try {
        const saved = storage.get('turbineId');
        const content = saved[1]
        const time = saved[0]
        let age = new Date() / 1000 - time
        if (age < ttl) {
          this.updateStatus(content)
        }
        console.log('auto log-in successful')
      } catch (e) {
        console.error('unable to auto log-in due to ' + e)
      }
    }
  }

  fetch(modelName, verb, kwargs) {
    if (modelName in this.modelWaiting) {
      return this.modelWaiting[modelName] = new Promise((a, r) => {
        this.modelWaiting[modelName].then(_ => {
          this.post(`${utils.kebabCase(modelName)}.${verb}`, kwargs)
            .then(a)
            .catch(r);
        })
      }).finally(_ => {
        delete this.modelWaiting[modelName]
      });
    }
    return this.modelWaiting[modelName] = this.post(`${utils.kebabCase(modelName)}.${verb}`, kwargs)
      .finally(_ => {
        delete this.modelWaiting[modelName];
      });
  }

  async post(url, data) {
    const endPoint = this.endPoint
    if (!this.isConnected) {
      this.emit('no-login')
      throw new TypeError('you are not logged in. Please log-in.')
    }
    if ([null, undefined].includes(data)) {
      data = {}
    }
    data.__token__ = this.status.token
    try {
      const xhr = await utils.xdr(endPoint + url, data, this.status.application, this.status.token)
      this.emit('http-response', xhr.responseText, xhr.status, url, data)
      this.emit('http-response-' + xhr.status, xhr.responseText, url, data)
      if (xhr.responseData) {
        this.emit('http-response-' + xhr.status + '-json', xhr.responseData, url, data)
      }
      return xhr.responseData || xhr.responseText
    } catch (xhr) {
      if (xhr.responseData) {
        this.emit('error-json', xhr.responseData, xhr.status, url, data, xhr)
        this.emit('error-json-' + xhr.status, xhr.responseData, url, data, xhr)
      } else {
        this.emit('error-http', xhr.responseText, xhr.status, url, data, xhr)
        this.emit('error-http-' + xhr.status, xhr.responseText, url, data, xhr)
      }
      throw new Error(xhr.responseData || xhr.responseText)
    }
  }

  login(username, password) {
    const self = this
    return new Promise((accept) => {
      utils.xdr(
          this.endPoint + 'auth/login',
          {
            username: username || '',
            password: password || ''
          },
          null,
          this.status.token,
          false
        ).then(
          (xhr) => {
            // update status
            self.updateStatus(xhr.responseData)
            accept(self.status)
          },
          (xhr) => {
            // if error call error manager with error
            let error = 'Could not receive error from server'
            if (xhr.responseData && 'error' in xhr.responseData) {
              error = xhr.responseData.error
              if (error) {
                accept({ error: error, status: 'error' })
              }
            }
            if (xhr.responseText) {
              error = xhr.responseText;
            }
            accept({ error: error, status: 'error' })
          }
        )
    })
  }

  async logout() {
    try {
      const ret = await this.post('auth/logout')
      storage.del('turbineId');
      this.updateStatus({});
      return ret;
    } catch (err) {
      console.error(err);
    }
  }

  updateStatus(status) {
    const lastBuild = parseFloat(storage.get('lastBuild')) || 1
    if (lastBuild < status.last_build) {
      utils.cleanDescription()
      storage.set('lastBuild', status.last_build)
    }
    this.isConnected = Boolean(status.token)
    this.isLoggedIn = Boolean(status.user?.id)
    const oldStatus = this.status
    this.status = status
    if (!oldStatus.user && status.user) {
      this.emit('logged-in', status)
      if (this.resMan.orm.keepSession) {
        storage.set('turbineId', [new Date().getTime() / 1000, status]);
      }
    } else if (oldStatus.user_id && !status.username) {
      this.emit('logged-out')
    } else if (this.isConnected && !this.isLoggedIn) {
      this.emit('login-required')
      if (this.getLogin) {
        var loginInfo = this.getLogin()
        if (loginInfo.constructor === Object) {
          this.login(loginInfo.username, loginInfo.password, loginInfo.callBack)
        } else if (loginInfo.constructor === Promise) {
          loginInfo.then(function (obj) {
            this.login(obj.username, obj.password, obj.callBack)
          })
        }
      }
    }
    if (status.wsConnection) {
      this.wsConnection = new JSAlchemyWsConnection(this, status.wsConnection)
    }
  }
}

export { JSAlchemyConnection, JSAlchemyWsConnection }
