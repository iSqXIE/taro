import { isEmptyObject } from './util'
import { updateComponent } from './lifecycle'
const privatePropValName = '__triggerObserer'
const anonymousFnNamePreffix = 'func__'
const pageExtraFns = ['onPullDownRefresh', 'onReachBottom', 'onShareAppMessage', 'onPageScroll', 'onTabItemTap']

function bindProperties (weappComponentConf, ComponentClass) {
  weappComponentConf.properties = ComponentClass.properties || {}
  // 拦截props的更新，插入生命周期
  // 调用小程序setData或会造成性能消耗
  weappComponentConf.properties[privatePropValName] = {
    type: null,
    observer: function () {
      if (!this.$component || !this.$component.__isAttached) return
      const nextProps = filterProps(ComponentClass.properties, ComponentClass.defaultProps, this.$component.props, this.data)
      this.$component.props = nextProps
      this.$component._unsafeCallUpdate = true
      updateComponent(this.$component)
      this.$component._unsafeCallUpdate = false
    }
  }
}

function processEvent (eventHandlerName, obj) {
  if (obj[eventHandlerName]) return

  obj[eventHandlerName] = function (event) {
    if (event) {
      event.preventDefault = function () {}
      event.stopPropagation = function () {}
      Object.assign(event.target, event.detail)
      Object.assign(event.currentTarget, event.detail)
    }

    const scope = this.$component
    let callScope = scope
    const isAnonymousFn = eventHandlerName.indexOf(anonymousFnNamePreffix) > -1
    let realArgs = []
    let detailArgs = []
    let datasetArgs = []
    // 解析从dataset中传过来的参数
    const dataset = event.currentTarget.dataset
    const bindArgs = {}
    const eventHandlerNameLower = eventHandlerName.toLocaleLowerCase()
    Object.keys(dataset).forEach(key => {
      let keyLower = key.toLocaleLowerCase()
      if (/^e/.test(keyLower)) {
        // 小程序属性里中划线后跟一个下划线会解析成不同的结果
        keyLower = keyLower.replace(/^e/, '')
        keyLower = keyLower.toLocaleLowerCase()
        if (keyLower.indexOf(eventHandlerNameLower) >= 0) {
          const argName = keyLower.replace(eventHandlerNameLower, '')
          bindArgs[argName] = dataset[key]
        }
      }
    })
    // 如果是通过triggerEvent触发,并且带有参数
    if (event.detail && event.detail.__arguments && event.detail.__arguments.length > 0) {
      detailArgs = event.detail.__arguments
    }
    // 普通的事件（非匿名函数），会直接call
    if (!isAnonymousFn) {
      if ('so' in bindArgs) {
        if (bindArgs['so'] !== 'this') {
          callScope = bindArgs['so']
        }
        delete bindArgs['so']
      }
      if (detailArgs.length > 0) {
        detailArgs[0] && (callScope = detailArgs[0])
        detailArgs.shift()
      }
      if (!isEmptyObject(bindArgs)) {
        datasetArgs = Object.keys(bindArgs)
          .sort()
          .map(key => bindArgs[key])
      }
      realArgs = [...datasetArgs, ...detailArgs, event]
    } else {
      // 匿名函数，会将scope作为第一个参数
      let _scope = null
      if ('so' in bindArgs) {
        if (bindArgs['so'] !== 'this') {
          _scope = bindArgs['so']
        }
        delete bindArgs['so']
      }
      if (detailArgs.length > 0) {
        detailArgs[0] && (callScope = detailArgs[0])
        detailArgs.shift()
      }
      if (!isEmptyObject(bindArgs)) {
        datasetArgs = Object.keys(bindArgs)
          .sort()
          .map(key => bindArgs[key])
      }
      realArgs = [callScope || _scope, ...datasetArgs, ...detailArgs, event]
    }
    scope[eventHandlerName].apply(callScope, realArgs)
  }
}

function bindEvents (weappComponentConf, events, isPage) {
  weappComponentConf.methods = weappComponentConf.methods || {}
  const target = isPage ? weappComponentConf : weappComponentConf.methods
  events.forEach(name => {
    processEvent(name, target)
  })
}

function filterProps (properties, defaultProps = {}, componentProps, weappComponentData) {
  let newProps = {}
  for (const propName in properties) {
    if (propName === privatePropValName) {
      continue
    }
    if (typeof componentProps[propName] === 'function') {
      newProps[propName] = componentProps[propName]
    } else if (propName in weappComponentData &&
      (properties !== null || weappComponentData[propName] !== null)) {
      newProps[propName] = weappComponentData[propName]
    }
  }
  if (!isEmptyObject(defaultProps)) {
    for (const propName in defaultProps) {
      if (newProps[propName] === undefined) {
        newProps[propName] = defaultProps[propName]
      }
    }
  }
  return newProps
}

export function componentTrigger (component, key, args) {
  args = args || []
  if (key === 'componentWillUnmount') {
    component._dirty = true
    component._disable = true
    component.$router = {
      params: {}
    }
    component._pendingStates = []
    component._pendingCallbacks = []
  }
  component[key] && typeof component[key] === 'function' && component[key].call(component, ...args)
  if (key === 'componentWillMount') {
    component._dirty = false
    component._disable = false
    component.state = component.getState()
  }
}

let hasPageInited = false

function createComponent (ComponentClass, isPage) {
  const weappComponentConf = {
    data: {
      _componentProps: 1
    },
    attached (options = {}) {
      const props = filterProps(ComponentClass.properties, ComponentClass.defaultProps, {}, this.data)
      this.$component = new ComponentClass(props)
      this.$component._init(this)
      Object.assign(this.$component.$router.params, options)
      // attached之后才可以setData,
      // attached之前，小程序组件初始化时仍然会触发observer，__isAttached为否的时候放弃处理observer
      this.$component.__isAttached = true
    },
    ready () {
      if (isPage && !hasPageInited) {
        hasPageInited = true
      }
      // 页面Ready的时候setData更新，此时并未didMount,触发observer但不会触发子组件更新
      // 小程序组件ready，但是数据并没有ready，需要通过updateComponent来初始化数据，setData完成之后才是真正意义上的组件ready
      if (hasPageInited || isPage) {
        updateComponent(this.$component)
      }
    },
    detached () {
      componentTrigger(this.$component, 'componentWillUnmount')
    }
  }
  if (isPage) {
    weappComponentConf['onLoad'] = weappComponentConf['attached']
    weappComponentConf['onReady'] = weappComponentConf['ready']
    weappComponentConf['onUnload'] = weappComponentConf['detached']
    weappComponentConf['onShow'] = function () {
      componentTrigger(this.$component, 'componentDidShow')
    }
    weappComponentConf['onHide'] = function () {
      componentTrigger(this.$component, 'componentDidHide')
    }
    pageExtraFns.forEach(fn => {
      weappComponentConf[fn] = function () {
        componentTrigger(this.$component, fn, arguments)
      }
    })
  }
  bindProperties(weappComponentConf, ComponentClass)
  ComponentClass['$$events'] && bindEvents(weappComponentConf, ComponentClass['$$events'], isPage)
  return weappComponentConf
}

export default createComponent
