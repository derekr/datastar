import {
  DATASTAR_FETCH_EVENT,
  DATASTAR_READY_EVENT,
  DOCUMENT,
  MutationObserverClass,
} from '@engine/consts'
import { compileExpression } from '@engine/csp'
import { createError } from '@engine/errors'
import { root } from '@engine/signals'
import type {
  ActionContext,
  ActionPlugin,
  AttributeContext,
  AttributePlugin,
  DatastarFetchEvent,
  HTMLOrSVG,
  Modifiers,
  Requirement,
  WatcherPlugin,
} from '@engine/types'
import { isHTMLOrSVG } from '@utils/dom'
import { aliasify, unaliasify } from '@utils/text'

const actionPlugins: Map<string, ActionPlugin> = new Map()
const attributePlugins: Map<string, AttributePlugin> = new Map()
const watcherPlugins: Map<string, WatcherPlugin> = new Map()

export const actions: Record<
  string,
  (ctx: ActionContext, ...args: any[]) => any
> = new Proxy(
  {},
  {
    get: (_, prop: string) => actionPlugins.get(prop)?.apply,
    has: (_, prop: string) => actionPlugins.has(prop),
    ownKeys: () => Reflect.ownKeys(actionPlugins),
    set: () => false,
    deleteProperty: () => false,
  },
)

// Map of cleanups keyed by element, attribute name, and cleanup name
const removals = new Map<HTMLOrSVG, Map<string, Map<string, () => void>>>()

const queuedAttributes: AttributePlugin[] = []
const queuedAttributeNames = new Set<string>()
const observedRoots = new Set<HTMLOrSVG | ShadowRoot>()
let datastarReadyDispatched = false

export const attribute = <R extends Requirement, B extends boolean>(
  plugin: AttributePlugin<R, B>,
): void => {
  queuedAttributes.push(plugin as unknown as AttributePlugin)

  if (queuedAttributes.length === 1) {
    setTimeout(flushQueued)
  }
}

// Plugins registered while the first apply is yielding wait for it to
// finish, as they would have if it had run in one task.
let initialApplyDone: (() => void)[] | undefined

const flushQueued = (): void => {
  if (initialApplyDone) {
    initialApplyDone.push(flushQueued)
    return
  }
  for (const attribute of queuedAttributes) {
    queuedAttributeNames.add(attribute.name)
    attributePlugins.set(attribute.name, attribute)
  }
  pluginNames = undefined
  queuedAttributes.length = 0
  if (!observedRoots.size) {
    // The first apply covers the whole document, so it yields to the
    // browser between chunks instead of running as one long task.
    initialApplyDone = []
    applyInitial(DOCUMENT.documentElement, () => {
      queuedAttributeNames.clear()
      const done = initialApplyDone!
      initialApplyDone = undefined
      for (const fn of done) fn()
    })
    return
  }
  for (const root of observedRoots) {
    applyQueued(root, false)
  }
  queuedAttributeNames.clear()
}

export const action = <T>(plugin: ActionPlugin<T>): void => {
  actionPlugins.set(plugin.name, plugin)
  pluginNames = undefined
}

// The names behind each context's `loadedPluginNames`, listed again only
// after a plugin is registered rather than for every attribute applied.
let pluginNames: { actions: string[]; attributes: string[] } | undefined
const currentPluginNames = () =>
  (pluginNames ??= {
    actions: [...actionPlugins.keys()],
    attributes: [...attributePlugins.keys()],
  })

DOCUMENT.addEventListener(DATASTAR_FETCH_EVENT, ((
  evt: CustomEvent<DatastarFetchEvent>,
) => {
  const plugin = watcherPlugins.get(evt.detail.type)
  if (plugin) {
    plugin.apply(
      {
        error: createError.bind(0, {
          plugin: { type: 'watcher', name: plugin.name },
          element: {
            id: (evt.target as Element).id,
            tag: (evt.target as Element).tagName,
          },
        }),
      },
      evt.detail.argsRaw,
    )
  }
}) as EventListener)

export const watcher = (plugin: WatcherPlugin): void => {
  watcherPlugins.set(plugin.name, plugin)
}

const cleanupEls = (els: Iterable<HTMLOrSVG>): void => {
  for (const el of els) {
    const elCleanups = removals.get(el)
    if (elCleanups && removals.delete(el)) {
      for (const attrCleanups of elCleanups.values()) {
        for (const cleanup of attrCleanups.values()) {
          cleanup()
        }
      }
    }
  }
}

const aliasedIgnore = aliasify('ignore')
const aliasedIgnoreAttr = `[${aliasedIgnore}]`
const shouldIgnore = (el: HTMLOrSVG) =>
  el.hasAttribute(`${aliasedIgnore}__self`) || !!el.closest(aliasedIgnoreAttr)

// Whether an element has any data-* attribute. Elements without one have
// nothing to apply, so they skip the ignore lookup (a `closest` call) and
// the dataset and attribute walks below.
const hasDataAttribute = (el: HTMLOrSVG): boolean => {
  const attrs = el.attributes
  for (let i = 0; i < attrs.length; i++) {
    if (attrs[i].name.startsWith('data-')) return true
  }
  return false
}

const applyEls = (els: Iterable<HTMLOrSVG>, onlyNew?: boolean): void => {
  for (const el of els) {
    if (hasDataAttribute(el) && !shouldIgnore(el)) {
      const appliedKeys = new Set<string>()
      for (const key in el.dataset) {
        const attrKey = key.replace(/[A-Z]/g, '-$&').toLowerCase()
        appliedKeys.add(attrKey)
        applyAttributePlugin(el, attrKey, el.dataset[key]!, onlyNew)
      }
      for (const attr of Array.from(el.attributes)) {
        if (!attr.name.startsWith('data-')) continue
        const attrKey = attr.name.slice(5)
        if (appliedKeys.has(attrKey)) continue
        applyAttributePlugin(el, attrKey, attr.value, onlyNew)
      }
    }
  }
}

const observe = (mutations: MutationRecord[]) => {
  for (const {
    target,
    type,
    attributeName,
    addedNodes,
    removedNodes,
  } of mutations) {
    if (type === 'childList') {
      for (const node of removedNodes) {
        if (isHTMLOrSVG(node)) {
          cleanupEls([node])
          cleanupEls(node.querySelectorAll<HTMLOrSVG>('*'))
        }
      }

      for (const node of addedNodes) {
        if (isHTMLOrSVG(node)) {
          applyEls([node])
          applyEls(node.querySelectorAll<HTMLOrSVG>('*'))
        }
      }
    } else if (
      type === 'attributes' &&
      attributeName!.startsWith('data-') &&
      isHTMLOrSVG(target) &&
      !shouldIgnore(target)
    ) {
      // skip over 'data-'
      const rawAttrKey = attributeName!.slice(5)
      const key = unaliasify(rawAttrKey)
      if (!key) continue
      const value = target.getAttribute(attributeName!)
      if (value === null) {
        const elCleanups = removals.get(target)
        if (elCleanups) {
          const attrCleanups = elCleanups.get(key)
          if (attrCleanups) {
            for (const cleanup of attrCleanups.values()) {
              cleanup()
            }
            elCleanups.delete(key)
          }
        }
      } else {
        applyAttributePlugin(target, rawAttrKey, value)
      }
    }
  }
}

// TODO: mutation observer per root so applying to web component doesnt overwrite main observer
const mutationObserver = new MutationObserverClass(observe)

export const parseAttributeKey = (
  rawKey: string,
): {
  pluginName: string
  key: string | undefined
  mods: Modifiers
} => {
  const [namePart, ...rawModifiers] = rawKey.split('__')
  const [pluginName, key] = namePart.split(/:(.+)/)
  const mods: Modifiers = new Map()

  for (const rawMod of rawModifiers) {
    const [label, ...mod] = rawMod.split('.')
    mods.set(label, new Set(mod))
  }

  return { pluginName, key, mods }
}

export const isDocumentObserverActive = () =>
  observedRoots.has(DOCUMENT.documentElement)

const dispatchDatastarReady = () => {
  if (datastarReadyDispatched || !isDocumentObserverActive()) return
  datastarReadyDispatched = true
  DOCUMENT.dispatchEvent(new Event(DATASTAR_READY_EVENT))
}

const applyQueued = (
  root: HTMLOrSVG | ShadowRoot = DOCUMENT.documentElement,
  observeRoot = true,
): void => {
  if (isHTMLOrSVG(root)) {
    applyEls([root], true)
  }
  applyEls(root.querySelectorAll<HTMLOrSVG>('*'), true)

  if (observeRoot) {
    mutationObserver.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
    })
    observedRoots.add(root)
    dispatchDatastarReady()
  }
}

// How long one chunk of the first apply may run before it yields.
const APPLY_CHUNK_MS = 30

// The first apply over the document, in document order like applyQueued,
// but in chunks of APPLY_CHUNK_MS with a task boundary between them, so the
// browser can paint and handle input while a large page is being applied.
// What other tasks change between chunks is replayed the way the document
// observer would have handled it after a one-task apply: removed elements
// are applied if not reached yet, then cleaned up; added and changed
// elements are applied, except those not reached yet, which are applied in
// their turn with the attributes they have then.
const applyInitial = (root: HTMLOrSVG, done: () => void): void => {
  const pending = [root, ...root.querySelectorAll<HTMLOrSVG>('*')]
  const waiting = new Set(pending)
  let next = 0

  const replayGap = (mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.removedNodes) {
          if (isHTMLOrSVG(node)) {
            const els = [node, ...node.querySelectorAll<HTMLOrSVG>('*')]
            // A one-task apply would have applied these before they were
            // removed, so apply the ones not reached yet, then clean up.
            const unreached = els.filter((el) => waiting.delete(el))
            if (unreached.length) applyEls(unreached, true)
            cleanupEls(els)
          }
        }
        for (const node of mutation.addedNodes) {
          if (isHTMLOrSVG(node)) {
            const els = [node, ...node.querySelectorAll<HTMLOrSVG>('*')]
            applyEls(els.filter((el) => !waiting.has(el)))
          }
        }
      } else if (
        isHTMLOrSVG(mutation.target) &&
        !waiting.has(mutation.target)
      ) {
        observe([mutation])
      }
    }
  }

  // Watches the document only between chunks, so the changes it sees are
  // other tasks', not the apply's own.
  const gapObserver = new MutationObserverClass(replayGap)

  const chunk = () => {
    const gap = gapObserver.takeRecords()
    gapObserver.disconnect()
    replayGap(gap)
    const start = performance.now()
    while (next < pending.length) {
      const el = pending[next++]
      // Elements another task removed between chunks were handled then.
      if (waiting.delete(el)) applyEls([el], true)
      if (performance.now() - start > APPLY_CHUNK_MS && next < pending.length) {
        gapObserver.observe(root, {
          subtree: true,
          childList: true,
          attributes: true,
        })
        setTimeout(chunk)
        return
      }
    }
    mutationObserver.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
    })
    observedRoots.add(root)
    dispatchDatastarReady()
    done()
  }
  chunk()
}

export const apply = (
  root: HTMLOrSVG | ShadowRoot = DOCUMENT.documentElement,
  observeRoot = true,
): void => {
  if (isHTMLOrSVG(root)) {
    applyEls([root])
  }
  applyEls(root.querySelectorAll<HTMLOrSVG>('*'))

  if (observeRoot) {
    mutationObserver.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
    })
    observedRoots.add(root)
    dispatchDatastarReady()
  }
}

export const applyElement = (el: HTMLOrSVG, onlyNew = false): void => {
  applyEls([el], onlyNew)
}

const applyAttributePlugin = (
  el: HTMLOrSVG,
  attrKey: string,
  value: string,
  onlyNew?: boolean,
): void => {
  const rawKey = unaliasify(attrKey)
  if (!rawKey) return
  const { pluginName, key, mods } = parseAttributeKey(rawKey)
  const plugin = attributePlugins.get(pluginName)
  const shouldApply =
    (!onlyNew || queuedAttributeNames.has(pluginName)) && !!plugin
  if (shouldApply) {
    // `loadedPluginNames` is built on first read: each context still gets
    // its own Sets of the plugins loaded when it was applied, but contexts
    // whose plugin never reads them (all of the built-in ones) skip
    // building them.
    const names = currentPluginNames()
    let loadedPluginNames: AttributeContext['loadedPluginNames'] | undefined
    const ctx = {
      el,
      rawKey,
      mods,
      error: createError.bind(0, {
        plugin: { type: 'attribute', name: plugin.name },
        element: { id: el.id, tag: el.tagName },
        expression: { rawKey, key, value },
      }),
      key,
      value,
      get loadedPluginNames() {
        return (loadedPluginNames ??= {
          actions: new Set(names.actions),
          attributes: new Set(names.attributes),
        })
      },
      set loadedPluginNames(value) {
        loadedPluginNames = value
      },
      rx: undefined,
    } as AttributeContext

    const keyReq =
      (plugin.requirement &&
        (typeof plugin.requirement === 'string'
          ? plugin.requirement
          : plugin.requirement.key)) ||
      'allowed'
    const valueReq =
      (plugin.requirement &&
        (typeof plugin.requirement === 'string'
          ? plugin.requirement
          : plugin.requirement.value)) ||
      'allowed'

    const keyProvided = key !== undefined && key !== null && key !== ''
    const valueProvided = value !== undefined && value !== null && value !== ''

    if (keyProvided) {
      if (keyReq === 'denied') {
        throw ctx.error('KeyNotAllowed')
      }
    } else if (keyReq === 'must') {
      throw ctx.error('KeyRequired')
    }

    if (valueProvided) {
      if (valueReq === 'denied') {
        throw ctx.error('ValueNotAllowed')
      }
    } else if (valueReq === 'must') {
      throw ctx.error('ValueRequired')
    }

    if (keyReq === 'exclusive' || valueReq === 'exclusive') {
      if (keyProvided && valueProvided) {
        throw ctx.error('KeyAndValueProvided')
      }
      if (!keyProvided && !valueProvided) {
        throw ctx.error('KeyOrValueRequired')
      }
    }

    const cleanups = new Map<string, () => void>()
    if (valueProvided) {
      let cachedRx: GenRxFn
      ctx.rx = (...args: any[]) => {
        if (!cachedRx) {
          cachedRx = genRx(value, {
            returnsValue_: plugin.returnsValue,
            argNames_: plugin.argNames,
            cleanups_: cleanups,
          })
        }
        return cachedRx(el, ...args)
      }
    }

    const cleanup = plugin.apply(ctx)
    if (cleanup) {
      cleanups.set('attribute', cleanup)
    }

    let elCleanups = removals.get(el)
    if (elCleanups) {
      const attrCleanups = elCleanups.get(rawKey)
      if (attrCleanups) {
        for (const oldCleanup of attrCleanups.values()) {
          oldCleanup()
        }
      }
    } else {
      elCleanups = new Map()
      removals.set(el, elCleanups)
    }
    elCleanups.set(rawKey, cleanups)
  }
}

type GenRxOptions = {
  returnsValue_?: boolean
  argNames_?: string[]
  cleanups_?: Map<string, () => void>
}

type GenRxFn = <T>(el: HTMLOrSVG, ...args: any[]) => T

const signalPath = (name: string): string =>
  name
    .split('.')
    .reduce((path, part) => `${path}['${part}']`, '$')

export const genRx = (
  value: string,
  {
    returnsValue_: returnsValue = false,
    argNames_: argNames = [],
    cleanups_: cleanups = new Map(),
  }: GenRxOptions = {},
): GenRxFn => {
  let expr = ''
  if (returnsValue) {
    // This regex allows Datastar expressions to support nested
    // regex and strings that contain ; without breaking.
    //
    // Each of these regex defines a block type we want to match
    // (importantly we ignore the content within these blocks):
    //
    // regex              \/(?:\\\/|[^\/])*\/
    // double quotes      "(?:\\"|[^\"])*"
    // single quotes      '(?:\\'|[^'])*'
    // ticks              `(?:\\`|[^`])*`
    // iife               \(\s*(?:(?:function)\s*\(\s*\)|(?:\(\s*\))\s*=>)\s*(?:\{[\s\S]*?\}|[^;)\{]*)\s*\)\s*\(\s*\)
    //
    // The iife support is (intentionally) limited. It only supports
    // function and arrow syntax with no arguments, and no nested IIFEs.
    //
    // We also want to match the non delimiter part of statements
    // note we only support ; statement delimiters:
    // [^;]
    //
    // Optimized using non-capturing groups (?:...) to prevent unnecessary backtracking.
    const statementRe =
      /(?:\/(?:\\\/|[^/])*\/|"(?:\\"|[^"])*"|'(?:\\'|[^'])*'|`(?:\\`|[^`])*`|\(\s*(?:(?:function)\s*\(\s*\)|(?:\(\s*\))\s*=>)\s*(?:\{[\s\S]*?\}|[^;){]*)\s*\)\s*\(\s*\)|[^;])+/gm
    const statements = value.trim().match(statementRe)
    if (statements) {
      const lastIdx = statements.length - 1
      const last = statements[lastIdx].trim()
      if (!last.startsWith('return')) {
        statements[lastIdx] = `return (${last});`
      }
      expr = statements.join(';\n')
    }
  } else {
    expr = value.trim()
  }

  // Replace signal references with bracket notation and action calls with the internal action dispatcher.
  // Examples:
  //   $count          -> $['count']
  //   $count--        -> $['count']--
  //   $foo.bar        -> $['foo']['bar']
  //   $foo-bar        -> $['foo-bar']
  //   $foo.bar-baz    -> $['foo']['bar-baz']
  //   $foo-$bar       -> $['foo']-$['bar']
  //   $arr[$index]    -> $['arr'][$['index']]
  //   $['foo']        -> $['foo']
  //   $foo[obj.bar]   -> $['foo'][obj.bar]
  //   $foo['bar.baz'] -> $['foo']['bar.baz']
  //   $123            -> $['123']
  //   $foo.0.name     -> $['foo']['0']['name']
  //   @get('/foo')    -> __action("get",evt,'/foo')

  // Skip replacements inside string/template literals.
  // Template interpolation support rewrites `${...}` only when braces are non-nested.
  expr = expr.replace(
    /(?:"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|`[^`\\$]*(?:(?:\\.|\$(?!\{))[^`\\$]*)*`)|\$\{([^{}]*)\}|\$(\w+(?:[.-]\w+)*)|@([A-Za-z_$][\w$]*)\(/g,
    (match, interpolationExpr, signalName, actionName) => {
      if (interpolationExpr !== undefined) {
        return `\${${interpolationExpr
          .replace(
            /\$(\w+(?:[.-]\w+)*)/g,
            (_: string, name: string) => signalPath(name),
          )
          .replace(/@([A-Za-z_$][\w$]*)\(/g, '__action("$1",evt,')}}`
      }
      if (signalName) return signalPath(signalName)
      if (actionName) return `__action("${actionName}",evt,`
      return match
    },
  )

  try {
    const fn = compileExpression(
      ['el', '$', '__action', 'evt', ...argNames],
      expr,
    )
    return (el: HTMLOrSVG, ...args: any[]) => {
      const action = (name: string, evt: Event | undefined, ...args: any[]) => {
        const err = createError.bind(0, {
          plugin: { type: 'action', name },
          element: { id: el.id, tag: el.tagName },
          expression: {
            fnContent: expr,
            value,
          },
        })
        const fn = actions[name]
        if (fn) {
          return fn(
            {
              el,
              evt,
              error: err,
              cleanups,
            },
            ...args,
          )
        }
        throw err('UndefinedAction')
      }
      try {
        return fn(el, root, action, undefined, ...args)
      } catch (e: any) {
        console.error(e)
        throw createError(
          {
            element: { id: el.id, tag: el.tagName },
            expression: {
              fnContent: expr,
              value,
            },
            error: e.message,
          },
          'ExecuteExpression',
        )
      }
    }
  } catch (e: any) {
    console.error(e)
    throw createError(
      {
        expression: {
          fnContent: expr,
          value,
        },
        error: e.message,
      },
      'GenerateExpression',
    )
  }
}
