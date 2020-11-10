/*
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview This converts from TypeDoc's JSON format to an internal representation for
 * display.
 */

const typedoc = require('typedoc');
const {LogLevel: TypeDocLogLevel} = require('typedoc/dist/lib/utils');
const {extractComment, exportedChildren} = require('./helpers');
const {declarationToType} = require('./converter');

/**
 * Generates the TypeDoc internal representation for the passed source. This invokes typedoc's
 * Application bundle and throws on failures.
 *
 * @param {string} source
 * @return {typedoc.ProjectReflection}
 */
function generateTypeDocObject(source) {
  const a = new typedoc.Application();
  a.bootstrap({
    includeDeclarations: true,
    // TODO(samthor): TypeDoc tries to consume all types in this project, but we only want to load
    // the specific .d.ts file. We can't exclude */** as this catches the .d.ts we want.
    exclude: ['**/node_modules/**'],
    entryPoint: source,

    logger(message, level) {
      switch (level) {
        case TypeDocLogLevel.Warn:
        case TypeDocLogLevel.Error:
          throw new Error(`could not convert types: ${message}`);
      }
      console.warn(message);
    },
  });

  const reflection = a.convert([source]);
  if (!reflection) {
    throw new Error('could not convert types, null return value');
  }
  return reflection;
}

/**
 * Finds all exported namespaces prefixed with "chrome." inside the passed project, and flattens
 * into a returned object.
 *
 * (If a namespace is exported under many names, it will appear many times, but this doesn't happen
 * in Chrome's types.)
 *
 * @param {typedoc.ProjectReflection} typesData
 * @return {{[name: string]: typedoc.DeclarationReflection}}
 */
function extractPublicChromeNamespaces(typesData) {
  /** @type {{[name: string]: typedoc.DeclarationReflection}} */
  const out = {};

  /**
   * @param {typedoc.DeclarationReflection} namespace
   * @param {string} prefix
   */
  const findContainedNamespaces = (namespace, prefix) => {
    const deep = exportedChildren(namespace, typedoc.ReflectionKind.Namespace);

    for (const name in deep) {
      const reflection = deep[name];
      const key = `${prefix}.${name}`;
      out[key] = reflection;

      // Find additional exported namespaces under this namespace.
      findContainedNamespaces(reflection, key);
    }
  };

  // Awkwardly extract the top-level "chrome" namespace.
  const {children: toplevelChildren = []} = typesData;
  if (toplevelChildren.length !== 1 || toplevelChildren[0].kind !== 1) {
    throw new TypeError('expected single top-level module');
  }
  const toplevel = toplevelChildren[0];
  const chromeNamespace =
    /** @type {typedoc.DeclarationReflection|undefined} */
    (toplevel.getChildByName('chrome'));
  if (!chromeNamespace) {
    throw new TypeError('expected module to contain `chrome`');
  }
  findContainedNamespaces(chromeNamespace, 'chrome');

  return out;
}

/**
 * @param {string} typesPath
 * @return {RenderNamespace[]}
 */
module.exports = typesPath => {
  const projectReflection = generateTypeDocObject(typesPath);

  // Generate namespaces in isolation (e.g. `chrome.management` and so on).
  const namespaces = extractPublicChromeNamespaces(projectReflection);
  const flat = [];
  for (const name in namespaces) {
    const reflection = namespaces[name];
    const [, ...rest] = name.split('.');
    const shortName = rest.join('.');

    /** @type {RenderNamespace} */
    const renderNamespace = {
      name,
      shortName,
      comment: extractComment(reflection.comment),
      types: [],
      properties: [],
      methods: [],
    };
    flat.push(renderNamespace);

    // Extract types/properties/methods by finding different kinds of children from the namespace's
    // DeclarationReflection.
    const groups = [
      {
        target: renderNamespace.types,
        mask:
          typedoc.ReflectionKind.Enum |
          typedoc.ReflectionKind.TypeLiteral |
          typedoc.ReflectionKind.TypeAlias |
          typedoc.ReflectionKind.Interface,
      },
      {
        target: renderNamespace.methods,
        mask: typedoc.ReflectionKind.Function,
      },
      {
        target: renderNamespace.properties,
        mask: typedoc.ReflectionKind.Property | typedoc.ReflectionKind.Variable,
      },
    ];
    for (const {target, mask} of groups) {
      const all = exportedChildren(reflection, mask);
      for (const name in all) {
        const rt = declarationToType(all[name]);
        rt.name = name;
        target.push(rt);
      }
    }
  }

  // Returns as an already sorted Array.
  flat.sort(({name: a}, {name: b}) => a.localeCompare(b));
  return flat;
};