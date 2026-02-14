import type { Package } from "./types";

export const packages: Package[] = [
  {
    name: "react",
    version: "18.2.0",
    description: "A JavaScript library for building user interfaces",
    author: "Jordan Walke",
    weeklyDownloads: 23000000,
    license: "MIT",
    keywords: ["react", "ui", "frontend", "javascript", "components"],
    publishedDate: "2013-05-29",
    lastPublished: "2 months ago",
    repository: "https://github.com/facebook/react",
    homepage: "https://react.dev",
    readme: `# React

React is a JavaScript library for building user interfaces.

![Build Status](https://img.shields.io/github/actions/workflow/status/facebook/react/runtime_build.yml)
![npm](https://img.shields.io/npm/v/react)
![License](https://img.shields.io/npm/l/react)

## Overview

React makes it painless to create interactive UIs. Design simple views for each state in your application, and React will efficiently update and render just the right components when your data changes. Declarative views make your code more predictable, simpler to understand, and easier to debug.

Build encapsulated components that manage their own state, then compose them to make complex UIs. Since component logic is written in JavaScript instead of templates, you can easily pass rich data through your app and keep state out of the DOM.

## Installation

\`\`\`bash
npm install react
\`\`\`

## Usage

\`\`\`jsx
import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return <h1>Hello, world!</h1>;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
\`\`\`

## Documentation

You can find the React documentation on the [official website](https://react.dev).

## License

MIT Licensed. Copyright (c) Meta Platforms, Inc. and affiliates.`,
    dependencies: {
      "loose-envify": "^1.1.0",
    },
    versions: [
      { version: "18.2.0", date: "2022-06-14" },
      { version: "18.1.0", date: "2022-04-26" },
      { version: "18.0.0", date: "2022-03-29" },
      { version: "17.0.2", date: "2021-03-22" },
      { version: "17.0.1", date: "2020-10-22" },
      { version: "16.14.0", date: "2020-10-14" },
      { version: "16.13.1", date: "2020-03-19" },
    ],
  },
  {
    name: "express",
    version: "4.18.2",
    description: "Fast, unopinionated, minimalist web framework for Node.js",
    author: "TJ Holowaychuk",
    weeklyDownloads: 30000000,
    license: "MIT",
    keywords: ["express", "framework", "web", "http", "rest"],
    publishedDate: "2010-12-29",
    lastPublished: "6 months ago",
    repository: "https://github.com/expressjs/express",
    homepage: "https://expressjs.com",
    readme: `# Express

Fast, unopinionated, minimalist web framework for [Node.js](https://nodejs.org).

![npm](https://img.shields.io/npm/v/express)
![npm downloads](https://img.shields.io/npm/dw/express)
![License](https://img.shields.io/npm/l/express)

## Overview

Express is a minimal and flexible Node.js web application framework that provides a robust set of features for web and mobile applications. It provides a thin layer of fundamental web application features, without obscuring Node.js features that you know and love.

With a myriad of HTTP utility methods and middleware at your disposal, creating a robust API is quick and easy.

## Installation

\`\`\`bash
npm install express
\`\`\`

## Quick Start

\`\`\`js
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
\`\`\`

## Features

- Robust routing
- Focus on high performance
- Super-high test coverage
- HTTP helpers (redirection, caching, etc.)
- Content negotiation
- Executable for generating applications quickly

## License

MIT Licensed. Copyright (c) 2009-2014 TJ Holowaychuk, 2013-2014 Roman Shtylman, 2014-2015 Douglas Christopher Wilson.`,
    dependencies: {
      "body-parser": "1.20.1",
      "cookie-parser": "~1.4.4",
      "content-disposition": "0.5.4",
      "content-type": "~1.0.4",
      "cookie": "0.5.0",
      "debug": "2.6.9",
      "depd": "2.0.0",
      "finalhandler": "1.2.0",
      "fresh": "0.5.2",
      "merge-descriptors": "1.0.1",
      "methods": "~1.1.2",
      "on-finished": "2.4.1",
      "parseurl": "~1.3.3",
      "path-to-regexp": "0.1.7",
      "proxy-addr": "~2.0.7",
      "qs": "6.11.0",
      "range-parser": "~1.2.1",
      "raw-body": "2.5.1",
      "safe-buffer": "5.2.1",
      "safer-buffer": "2.1.2",
      "send": "0.18.0",
      "serve-static": "1.15.0",
      "statuses": "2.0.1",
      "type-is": "~1.6.18",
      "utils-merge": "1.0.1",
      "vary": "~1.1.2",
    },
    versions: [
      { version: "4.18.2", date: "2022-10-08" },
      { version: "4.18.1", date: "2022-04-29" },
      { version: "4.18.0", date: "2022-04-25" },
      { version: "4.17.3", date: "2022-02-16" },
      { version: "4.17.2", date: "2021-12-16" },
      { version: "4.17.1", date: "2019-05-26" },
    ],
  },
  {
    name: "lodash",
    version: "4.17.21",
    description: "Lodash modular utilities",
    author: "John-David Dalton",
    weeklyDownloads: 52000000,
    license: "MIT",
    keywords: ["modules", "stdlib", "util", "lodash"],
    publishedDate: "2012-04-23",
    lastPublished: "3 years ago",
    repository: "https://github.com/lodash/lodash",
    homepage: "https://lodash.com",
    readme: `# Lodash

A modern JavaScript utility library delivering modularity, performance, & extras.

![npm](https://img.shields.io/npm/v/lodash)
![npm downloads](https://img.shields.io/npm/dw/lodash)

## Overview

Lodash makes JavaScript easier by taking the hassle out of working with arrays, numbers, objects, strings, etc. Lodash's modular methods are great for iterating arrays, objects, and strings, manipulating and testing values, and creating composite functions.

## Installation

\`\`\`bash
npm install lodash
\`\`\`

## Usage

\`\`\`js
const _ = require('lodash');

_.defaults({ 'a': 1 }, { 'a': 3, 'b': 2 });
// => { 'a': 1, 'b': 2 }

_.partition([1, 2, 3, 4], n => n % 2);
// => [[1, 3], [2, 4]]

_.map([1, 2, 3], n => n * 3);
// => [3, 6, 9]
\`\`\`

## Why Lodash?

Lodash is released in a variety of builds & module formats. It provides consistent cross-environment iteration support for arrays, strings, objects, and arguments objects. It has been the most depended-upon npm package for years.

## License

MIT Licensed. Copyright JS Foundation and other contributors.`,
    dependencies: {},
    versions: [
      { version: "4.17.21", date: "2021-02-20" },
      { version: "4.17.20", date: "2020-08-13" },
      { version: "4.17.19", date: "2020-07-04" },
      { version: "4.17.15", date: "2019-11-18" },
      { version: "4.17.14", date: "2019-07-19" },
      { version: "4.17.11", date: "2018-09-12" },
    ],
  },
  {
    name: "axios",
    version: "1.6.2",
    description: "Promise based HTTP client for the browser and node.js",
    author: "Matt Zabriskie",
    weeklyDownloads: 45000000,
    license: "MIT",
    keywords: ["xhr", "http", "ajax", "promise", "node"],
    publishedDate: "2014-08-29",
    lastPublished: "3 weeks ago",
    repository: "https://github.com/axios/axios",
    homepage: "https://axios-http.com",
    readme: `# Axios

Promise based HTTP client for the browser and node.js.

![npm](https://img.shields.io/npm/v/axios)
![npm downloads](https://img.shields.io/npm/dw/axios)
![License](https://img.shields.io/npm/l/axios)

## Overview

Axios is a simple promise-based HTTP client for the browser and node.js. It provides a single API for dealing with XMLHttpRequests and node's http interface, making it easy to use in both environments.

## Features

- Make XMLHttpRequests from the browser
- Make http requests from node.js
- Supports the Promise API
- Intercept request and response
- Transform request and response data
- Cancel requests
- Automatic transforms for JSON data
- Client side support for protecting against XSRF

## Installation

\`\`\`bash
npm install axios
\`\`\`

## Usage

\`\`\`js
const axios = require('axios');

// GET request
const response = await axios.get('/users/12345');
console.log(response.data);

// POST request
await axios.post('/users', {
  firstName: 'Fred',
  lastName: 'Flintstone'
});
\`\`\`

## License

MIT Licensed. Copyright (c) 2014-present Matt Zabriskie & Collaborators.`,
    dependencies: {
      "follow-redirects": "^1.15.0",
      "form-data": "^4.0.0",
      "proxy-from-env": "^1.1.0",
    },
    versions: [
      { version: "1.6.2", date: "2023-11-14" },
      { version: "1.6.1", date: "2023-11-08" },
      { version: "1.6.0", date: "2023-10-26" },
      { version: "1.5.1", date: "2023-09-26" },
      { version: "1.5.0", date: "2023-08-26" },
      { version: "1.4.0", date: "2023-04-07" },
    ],
  },
  {
    name: "typescript",
    version: "5.3.2",
    description:
      "TypeScript is a language for application scale JavaScript development",
    author: "Microsoft Corp.",
    weeklyDownloads: 42000000,
    license: "Apache-2.0",
    keywords: ["TypeScript", "Microsoft", "compiler", "language", "javascript"],
    publishedDate: "2012-10-01",
    lastPublished: "1 month ago",
    repository: "https://github.com/microsoft/TypeScript",
    homepage: "https://www.typescriptlang.org",
    readme: `# TypeScript

TypeScript is a language for application-scale JavaScript. TypeScript adds optional types to JavaScript that support tools for large-scale JavaScript applications.

![npm](https://img.shields.io/npm/v/typescript)
![npm downloads](https://img.shields.io/npm/dw/typescript)

## Overview

TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. Any browser. Any host. Any OS. Open source. TypeScript offers support for the latest and evolving JavaScript features, including those from ECMAScript 2015 and future proposals, like async functions and decorators.

## Installation

\`\`\`bash
npm install -g typescript
\`\`\`

## Usage

\`\`\`ts
interface User {
  name: string;
  id: number;
}

const user: User = {
  name: "Hayes",
  id: 0,
};

function greet(user: User) {
  console.log(\`Hello, \${user.name}\`);
}
\`\`\`

Compile with:

\`\`\`bash
tsc hello.ts
\`\`\`

## Documentation

For more information, visit the [TypeScript handbook](https://www.typescriptlang.org/docs/handbook).

## License

Apache-2.0 Licensed. Copyright (c) Microsoft Corporation.`,
    dependencies: {},
    versions: [
      { version: "5.3.2", date: "2023-11-20" },
      { version: "5.3.1", date: "2023-11-14" },
      { version: "5.2.2", date: "2023-08-24" },
      { version: "5.1.6", date: "2023-06-29" },
      { version: "5.0.4", date: "2023-04-24" },
      { version: "4.9.5", date: "2023-01-14" },
    ],
  },
  {
    name: "next",
    version: "14.0.3",
    description: "The React Framework",
    author: "Vercel",
    weeklyDownloads: 6000000,
    license: "MIT",
    keywords: ["react", "next", "framework", "ssr", "server-rendering"],
    publishedDate: "2016-10-25",
    lastPublished: "2 weeks ago",
    repository: "https://github.com/vercel/next.js",
    homepage: "https://nextjs.org",
    readme: `# Next.js

The React Framework for the Web.

![npm](https://img.shields.io/npm/v/next)
![npm downloads](https://img.shields.io/npm/dw/next)

## Overview

Used by some of the world's largest companies, Next.js enables you to create full-stack web applications by extending the latest React features, and integrating powerful Rust-based JavaScript tooling for the fastest builds.

Next.js provides a great developer experience with features such as file-system routing, server-side rendering, static generation, API routes, and more.

## Installation

\`\`\`bash
npx create-next-app@latest
\`\`\`

## Usage

\`\`\`jsx
// app/page.tsx
export default function Home() {
  return (
    <main>
      <h1>Welcome to Next.js</h1>
    </main>
  );
}
\`\`\`

Start the development server:

\`\`\`bash
npm run dev
\`\`\`

## Documentation

Visit [https://nextjs.org/docs](https://nextjs.org/docs) to view the full documentation.

## License

MIT Licensed. Copyright (c) 2024 Vercel, Inc.`,
    dependencies: {
      "@next/env": "14.0.3",
      "@swc/helpers": "0.5.2",
      "busboy": "1.6.0",
      "caniuse-lite": "^1.0.30001406",
      "graceful-fs": "^4.2.11",
      "postcss": "8.4.31",
      "styled-jsx": "5.1.1",
    },
    versions: [
      { version: "14.0.3", date: "2023-11-20" },
      { version: "14.0.2", date: "2023-11-09" },
      { version: "14.0.1", date: "2023-10-28" },
      { version: "14.0.0", date: "2023-10-26" },
      { version: "13.5.6", date: "2023-10-04" },
      { version: "13.4.19", date: "2023-08-25" },
    ],
  },
  {
    name: "webpack",
    version: "5.89.0",
    description:
      "Packs ECMAScript/CommonJs/AMD modules for the browser. Allows code splitting into multiple bundles.",
    author: "Tobias Koppers @sokra",
    weeklyDownloads: 27000000,
    license: "MIT",
    keywords: ["web", "webpack", "bundler", "module", "packer"],
    publishedDate: "2012-03-10",
    lastPublished: "1 month ago",
    repository: "https://github.com/webpack/webpack",
    homepage: "https://webpack.js.org",
    readme: `# webpack

Webpack is a module bundler. Its main purpose is to bundle JavaScript files for usage in a browser, yet it is also capable of transforming, bundling, or packaging just about any resource or asset.

![npm](https://img.shields.io/npm/v/webpack)
![npm downloads](https://img.shields.io/npm/dw/webpack)

## Overview

At its core, webpack is a static module bundler for modern JavaScript applications. When webpack processes your application, it internally builds a dependency graph from one or more entry points and then combines every module your project needs into one or more bundles.

## Installation

\`\`\`bash
npm install --save-dev webpack webpack-cli
\`\`\`

## Usage

\`\`\`js
// webpack.config.js
const path = require('path');

module.exports = {
  entry: './src/index.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
};
\`\`\`

Run webpack:

\`\`\`bash
npx webpack --config webpack.config.js
\`\`\`

## License

MIT Licensed. Copyright JS Foundation and other contributors.`,
    dependencies: {
      "@types/eslint-scope": "^3.7.3",
      "@types/estree": "^1.0.0",
      "@webassemblyjs/ast": "^1.11.5",
      "@webassemblyjs/wasm-edit": "^1.11.5",
      "@webassemblyjs/wasm-parser": "^1.11.5",
      "acorn": "^8.7.1",
      "acorn-import-assertions": "^1.9.0",
      "browserslist": "^4.14.5",
      "chrome-trace-event": "^1.0.2",
      "enhanced-resolve": "^5.15.0",
      "es-module-lexer": "^1.2.1",
      "eslint-scope": "5.1.1",
      "events": "^3.2.0",
      "glob-to-regexp": "^0.4.1",
      "graceful-fs": "^4.2.9",
      "json-parse-even-better-errors": "^2.3.1",
      "loader-runner": "^4.2.0",
      "mime-types": "^2.1.27",
      "neo-async": "^2.6.2",
      "schema-utils": "^3.2.0",
      "tapable": "^2.1.1",
      "terser-webpack-plugin": "^5.3.7",
      "watchpack": "^2.4.0",
      "webpack-sources": "^3.2.3",
    },
    versions: [
      { version: "5.89.0", date: "2023-10-04" },
      { version: "5.88.2", date: "2023-07-24" },
      { version: "5.88.1", date: "2023-07-05" },
      { version: "5.88.0", date: "2023-06-27" },
      { version: "5.87.0", date: "2023-06-13" },
      { version: "5.86.0", date: "2023-06-06" },
    ],
  },
  {
    name: "eslint",
    version: "8.54.0",
    description: "An AST-based pattern checker for JavaScript",
    author: "Nicholas C. Zakas",
    weeklyDownloads: 37000000,
    license: "MIT",
    keywords: ["ast", "lint", "javascript", "ecmascript", "espree"],
    publishedDate: "2013-07-05",
    lastPublished: "3 weeks ago",
    repository: "https://github.com/eslint/eslint",
    homepage: "https://eslint.org",
    readme: `# ESLint

ESLint is a tool for identifying and reporting on patterns found in ECMAScript/JavaScript code.

![npm](https://img.shields.io/npm/v/eslint)
![npm downloads](https://img.shields.io/npm/dw/eslint)
![License](https://img.shields.io/npm/l/eslint)

## Overview

ESLint is a tool for identifying and reporting on patterns found in ECMAScript/JavaScript code, with the goal of making code more consistent and avoiding bugs. ESLint is completely pluggable; every single rule is a plugin and you can add more at runtime.

## Installation

\`\`\`bash
npm init @eslint/config
\`\`\`

## Usage

\`\`\`bash
npx eslint yourfile.js
\`\`\`

Or configure in your project:

\`\`\`json
{
  "rules": {
    "semi": ["error", "always"],
    "quotes": ["error", "double"]
  }
}
\`\`\`

## Features

- Find problems in your code
- Fix problems automatically
- Configure everything
- Huge ecosystem of plugins

## License

MIT Licensed. Copyright OpenJS Foundation and other contributors.`,
    dependencies: {
      "@eslint-community/eslint-utils": "^4.2.0",
      "@eslint-community/regexpp": "^4.6.1",
      "@eslint/eslintrc": "^2.1.3",
      "@eslint/js": "8.54.0",
      "@humanwhocodes/config-array": "^0.11.13",
      "@humanwhocodes/module-importer": "^1.0.1",
      "@nodelib/fs.walk": "^1.2.8",
      "ajv": "^6.12.4",
      "chalk": "^4.0.0",
      "cross-spawn": "^7.0.2",
      "debug": "^4.3.2",
      "doctrine": "^3.0.0",
      "escape-string-regexp": "^4.0.0",
      "eslint-scope": "^7.2.2",
      "eslint-visitor-keys": "^3.4.3",
      "espree": "^9.6.1",
      "esquery": "^1.4.2",
      "esutils": "^2.0.2",
      "fast-deep-equal": "^3.1.3",
      "file-entry-cache": "^6.0.1",
      "find-up": "^5.0.0",
      "glob-parent": "^6.0.2",
      "globals": "^13.19.0",
      "graphemer": "^1.4.0",
      "ignore": "^5.2.0",
      "imurmurhash": "^0.1.4",
      "is-glob": "^4.0.0",
      "is-path-inside": "^3.0.3",
      "js-yaml": "^4.1.0",
      "json-stable-stringify-without-jsonify": "^1.0.1",
      "levn": "^0.4.1",
      "lodash.merge": "^4.6.2",
      "minimatch": "^3.1.2",
      "natural-compare": "^1.4.0",
      "optionator": "^0.9.3",
      "strip-ansi": "^6.0.1",
      "text-table": "^0.2.0",
    },
    versions: [
      { version: "8.54.0", date: "2023-11-10" },
      { version: "8.53.0", date: "2023-10-27" },
      { version: "8.52.0", date: "2023-10-13" },
      { version: "8.51.0", date: "2023-09-29" },
      { version: "8.50.0", date: "2023-09-15" },
      { version: "8.49.0", date: "2023-09-01" },
    ],
  },
  {
    name: "prettier",
    version: "3.1.0",
    description: "Prettier is an opinionated code formatter",
    author: "James Long",
    weeklyDownloads: 15000000,
    license: "MIT",
    keywords: ["code", "formatter", "style", "beauty", "prettier"],
    publishedDate: "2017-01-10",
    lastPublished: "1 month ago",
    repository: "https://github.com/prettier/prettier",
    homepage: "https://prettier.io",
    readme: `# Prettier

Prettier is an opinionated code formatter. It enforces a consistent style by parsing your code and re-printing it with its own rules that take the maximum line length into account.

![npm](https://img.shields.io/npm/v/prettier)
![npm downloads](https://img.shields.io/npm/dw/prettier)

## Overview

Prettier takes your code and reprints it from scratch by taking the line length into account. It removes all original styling and ensures that all outputted code conforms to a consistent style. By far the biggest reason for adopting Prettier is to stop all the on-going debates over styles.

## Installation

\`\`\`bash
npm install --save-dev prettier
\`\`\`

## Usage

\`\`\`bash
npx prettier --write .
\`\`\`

Or format a specific file:

\`\`\`bash
npx prettier --write src/index.js
\`\`\`

Example configuration (\`.prettierrc\`):

\`\`\`json
{
  "semi": true,
  "trailingComma": "all",
  "singleQuote": true,
  "printWidth": 80
}
\`\`\`

## License

MIT Licensed. Copyright (c) James Long and contributors.`,
    dependencies: {},
    versions: [
      { version: "3.1.0", date: "2023-11-13" },
      { version: "3.0.3", date: "2023-07-05" },
      { version: "3.0.2", date: "2023-06-28" },
      { version: "3.0.1", date: "2023-06-27" },
      { version: "3.0.0", date: "2023-06-26" },
      { version: "2.8.8", date: "2023-02-08" },
    ],
  },
  {
    name: "jest",
    version: "29.7.0",
    description: "Delightful JavaScript Testing",
    author: "Christoph Nakazawa",
    weeklyDownloads: 22000000,
    license: "MIT",
    keywords: ["testing", "javascript", "test", "runner", "delightful"],
    publishedDate: "2014-03-14",
    lastPublished: "4 months ago",
    repository: "https://github.com/jestjs/jest",
    homepage: "https://jestjs.io",
    readme: `# Jest

Delightful JavaScript Testing.

![npm](https://img.shields.io/npm/v/jest)
![npm downloads](https://img.shields.io/npm/dw/jest)
![License](https://img.shields.io/npm/l/jest)

## Overview

Jest is a delightful JavaScript Testing Framework with a focus on simplicity. It works with projects using Babel, TypeScript, Node, React, Angular, Vue, and more. Jest aims to work out of the box, config free, on most JavaScript projects.

## Installation

\`\`\`bash
npm install --save-dev jest
\`\`\`

## Usage

Create a \`sum.js\` file:

\`\`\`js
function sum(a, b) {
  return a + b;
}
module.exports = sum;
\`\`\`

Create a \`sum.test.js\` file:

\`\`\`js
const sum = require('./sum');

test('adds 1 + 2 to equal 3', () => {
  expect(sum(1, 2)).toBe(3);
});
\`\`\`

Run tests:

\`\`\`bash
npx jest
\`\`\`

## Features

- Zero config for most projects
- Snapshots for large objects
- Tests are parallelized for speed
- Great API with \`expect\` matchers
- Built-in code coverage

## License

MIT Licensed. Copyright (c) Meta Platforms, Inc. and affiliates.`,
    dependencies: {
      "@jest/core": "^29.7.0",
      "@jest/types": "^29.6.3",
      "import-local": "^3.0.2",
      "jest-cli": "^29.7.0",
    },
    versions: [
      { version: "29.7.0", date: "2023-09-12" },
      { version: "29.6.4", date: "2023-08-28" },
      { version: "29.6.3", date: "2023-08-18" },
      { version: "29.6.2", date: "2023-07-27" },
      { version: "29.6.1", date: "2023-07-06" },
      { version: "29.5.0", date: "2023-04-03" },
    ],
  },
  {
    name: "moment",
    version: "2.29.4",
    description: "Parse, validate, manipulate, and display dates",
    author: "Iskren Ivov Chernev",
    weeklyDownloads: 18000000,
    license: "MIT",
    keywords: ["moment", "date", "time", "parse", "format"],
    publishedDate: "2011-11-22",
    lastPublished: "1 year ago",
    repository: "https://github.com/moment/moment",
    homepage: "https://momentjs.com",
    readme: `# Moment.js

Parse, validate, manipulate, and display dates and times in JavaScript.

![npm](https://img.shields.io/npm/v/moment)
![npm downloads](https://img.shields.io/npm/dw/moment)

## Overview

Moment.js is a legacy project, now in maintenance mode. In most cases, you should choose a different library. For more details and recommendations, please see the [Project Status](https://momentjs.com/docs/#/-project-status/) in the docs.

Moment was designed to work both in the browser and in Node.js. It has been successfully used in millions of projects, and we are happy to have contributed to making date and time better on the web.

## Installation

\`\`\`bash
npm install moment
\`\`\`

## Usage

\`\`\`js
const moment = require('moment');

moment().format('MMMM Do YYYY, h:mm:ss a');
// => "February 14th 2024, 2:30:00 pm"

moment("20111031", "YYYYMMDD").fromNow();
// => "12 years ago"

moment().subtract(6, 'days').calendar();
// => "Last Thursday at 2:30 PM"
\`\`\`

## Note

Consider using alternatives like \`date-fns\`, \`luxon\`, or the native \`Intl\` API for new projects.

## License

MIT Licensed. Copyright (c) JS Foundation and other contributors.`,
    dependencies: {},
    versions: [
      { version: "2.29.4", date: "2022-07-06" },
      { version: "2.29.3", date: "2022-04-08" },
      { version: "2.29.2", date: "2022-04-01" },
      { version: "2.29.1", date: "2020-10-06" },
      { version: "2.29.0", date: "2020-09-21" },
      { version: "2.28.0", date: "2020-09-14" },
    ],
  },
  {
    name: "chalk",
    version: "5.3.0",
    description: "Terminal string styling done right",
    author: "Sindre Sorhus",
    weeklyDownloads: 200000000,
    license: "MIT",
    keywords: ["color", "colour", "terminal", "console", "cli"],
    publishedDate: "2013-06-18",
    lastPublished: "5 months ago",
    repository: "https://github.com/chalk/chalk",
    homepage: "https://github.com/chalk/chalk#readme",
    readme: `# Chalk

Terminal string styling done right.

![npm](https://img.shields.io/npm/v/chalk)
![npm downloads](https://img.shields.io/npm/dw/chalk)

## Overview

Chalk is a clean and focused library for terminal string styling. It provides an expressive API, has no dependencies, and is performant. Chalk comes with an easy to use composable API where you just chain and nest the styles you want.

## Highlights

- Expressive API
- Highly performant
- No dependencies
- Ability to nest styles
- 256/Truecolor color support
- Auto-detects color support
- Clean and focused

## Installation

\`\`\`bash
npm install chalk
\`\`\`

## Usage

\`\`\`js
import chalk from 'chalk';

console.log(chalk.blue('Hello world!'));
console.log(chalk.red.bold('Error!'));
console.log(chalk.green('Success') + ' operation completed.');
console.log(chalk.bgRed.white(' FAIL ') + ' Something went wrong');
\`\`\`

## Styles

Chalk supports modifiers like \`bold\`, \`dim\`, \`italic\`, \`underline\`, and various foreground and background colors.

## License

MIT Licensed. Copyright (c) Sindre Sorhus.`,
    dependencies: {},
    versions: [
      { version: "5.3.0", date: "2023-06-29" },
      { version: "5.2.0", date: "2023-01-16" },
      { version: "5.1.2", date: "2022-10-08" },
      { version: "5.1.0", date: "2022-09-30" },
      { version: "5.0.1", date: "2022-03-31" },
      { version: "5.0.0", date: "2021-12-12" },
    ],
  },
];
