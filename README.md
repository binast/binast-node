
# Code Organization

The code is organized into two node modules: `binast-schema`, and the main
`binast-node` module.

The `binast-schema` module provides generic code to lift a webidl schema into
a typescript schema.  The typescript file that it generates provides both a
"direct-translated" TypeScript version of the schema, as well as an embedded
reflective type-system.

The `binast-node` module implements the main front-end analysis - including
the code to lift an actual ES5 file into a typed representation (obtained
from the schema generated by `binast-schema`).

## Building

Run `npm run build` to do a full build.  This will build `binast-schema`,
then use it to generate a TypeScript schema from `spec/latest.webidl`
(stored into `src/typed_schema.ts`), and then builds the `binast-node` module.

Inspect `src/typed_schema.ts` after a build to get a feel for
what the typed and reflected schema definitions look like.

See `modules/binast-schema/src/generate.ts` for the typescript-generator code.

The first part of the generated schema will be the reflected code (defined
within the `ReflectedSchema` object), and the second part of the generated
schema will be the "direct" Typescript translation of the webidl (direct
declaration of TypeScript classes and enums corresponding to the webidl
interfaces and enums etc).

## Running Analyses

The main front-end executable is in `dist/bin/analysis.js`, transpiled from
`src/analysis.ts`.

Here is an exmaple of usage:

```
node ./dist/bin/analysis.js --script-dir=<SRC-DIR-DIR> --result-dir=<OUTPUT-DIR> --string-window --string-window-sizes=32,64
```

This command runs the 'string-window' analysis on the given source directory, wich should be a collection of Javascript files.  The source dir may have subdirectories with JS files, etc.

The analysis deposits its results within specific sub-directories of `<OUTPUT-DIR>`.  In the `string-window` analysis, analysis results are written to the `string-window/<window-size>` subdirectory.

The analyses implemented are:

1. Path suffix analysis.

  This analysis computes frequency counts for node types by considering
  a suffix (of some length) of the path to the node type.  The path-suffix
  analysis accepts a `--path-suffix-length` option that specifies the length
  of path suffixes to use to predict a node type.

  It deposits results in the `path-suffix/<LENGTH>` directory in the results
  directory.  Individual file are analyzed and their frequency information is
  dumped in a file-path corresponding to the input.  Both `json` and `txt`
  files are dumped.

  Cumulative frequencies are dumped into the `path-suffix/<LENGTH>/ALL.json`,
  with a corresponding `path-suffix/<LENGTH>/ALL.txt` text report of the same
  information.

  Usage:
  ```
  node ./dist/bin/analysis.js --script-dir=<SRC-DIR-DIR> --result-dir=<OUTPUT-DIR> --path-suffix --path-suffix-length=2
  ```

2. String window analysis.

  This analysis computes frequency tables for different sizes of move-to-front
  string window analysis.

  It deposits results in the `string-window/<WINDOW-SIZE>` subdirectory in the
  results directory.  It dumps results similarly to the path suffix analysis.

  Usage:
  ```
  node ./dist/bin/analysis.js --script-dir=<SRC-DIR-DIR> --result-dir=<OUTPUT-DIR> --string-window --string-window-sizes=32,64,...
  ```

3. Global strings.

  This analysis counts global strings across all files in a corpus.  We can
  use this to calculate which strings to include in an "implicit string
  dictionary" prelude for all files.

  Usage:
  ```
  node ./dist/bin/analysis.js --script-dir=<SRC-DIR-DIR> --result-dir=<OUTPUT-DIR> --global-strings
  ```

4. Entropy code.

  This analysis is the compressor.  It produces compressed, entropy-coded files
  using analysis results collected from previous runs (i.e. it reads data from
  the `--result-dir`, assuming that data has been computed by prior runs of
  the other analyses).

  The way to use this is to first run all the other analyses on the corpus,
  and then re-run the analysis script, selecting the entropy-code analysis.

  This analysis dumps statistical info to standard out (it doesn't produce
  reports yet).. but the compressed data is dumped to a `.TSC` extension file
  in the results dir (within subpath `entropy-code/<FILE>.TSC` where `<FILE>`
  is the base subpath of the javascript file in the source directory being
  encoded).

  Usage:
  ```
  node ./dist/bin/analysis.js --script-dir=<SRC-DIR-DIR> --result-dir=<OUTPUT-DIR> --entropy-code
  ```

## Binast-Schema

The `binast-schema` module implements generic code for lifting a webidl
file into a typed representation of a schema.

It exposes a script `generate.ts` (compiled into `dist/generate.js`) that
reads a spec webidl file and produces a Typescript file.  This script is
exported as `binast-generate-ts-schema` binary from the module (see the
`modules/binast-schema/package.json` file for details).

The main `binast-node` module uses this module to generate the schema.  It
also defines all the first-class TypeScript structures used to represent
reflected schemas.

The organization of the `binast-schema` module is described below.

### lift\_webidl.ts

This file implements the actual logic to read a webidl file and
produce a runtime `TreeSchema` from it.

### tree\_schema.ts

This file defines the classes that model actual values, type-values, and
the structure that models the schema itself.

 * `TreeSchema`

  A class that models the full schema.

 * `Typedef`

  Represents a type-definition in the webidl

 * `Enum`

  Represents an enum defined in the webidl.

 * `Iface`

  Represents an interface defined in the webidl.

### field\_type.ts

This file defines classes that model the kinds of types that can
be represented by the schema.

A `FieldType` base class is defined, and subclasses of this type
define particular kinds of types.

 * `FieldTypePrimitive`

  Used for all primitive field types such as uint, boolean, etc.

 * `FieldTypeIdent`

  Identifier field types.  There can be more than one kind of identifier
  type (e.g. Property vs. Identifier).

 * `FieldTypeNamed`

  Represents an unresolved named type.  These are used when a schema
  is first lifted, before names are resolved and all field types
  normalized into canonical form.

 * `FieldTypeUnion`

  Represents a union type.  Embeds a sequence of member types.

 * `FieldTypeArray`

  An array type.  Embeds a single type describing the array contents.

 * `FieldTypeIface`

  Type describing an interface.  Just embeds the interface name.

 * `FieldTypeEnum`

  Type describing enums.  Just embeds the enum type name.

The `field_type.ts` file also defines a `TypeSet` class which holds a
flat set of types.  A `TypeSet` is eventually computed for every location
in the tree, and used as a normalized representation of all the types
that can show up at that location.

There is also a `ResolvedType` class, which represents a particular value
in the tree, resolved under a `TypeSet`.  It references the TypeSet,
the type of the value, and the index of the type within the TypeSet.

A `ResolvedType` is obtainable through the a visitor implemnetation that
walks the tree, providing path and resolved type information for every
location of the tree in sequence.

### visit\_ast.ts

Provides a visitor implementation that allows easy traversal of
a schema-typed tree.

The visitor accepts a handler, and calls the handler for every element
in the tree (including child subtrees), providing it with a piece of
context.

The handler must provide `start` and `end` methods that are called
when a subtree or value is first "entered" as well as when it is "exited".

## Binast-Node

The `binast-node` module implements a Javsacript analysis tool using the
`binast-schema` module to model and manipulate the typed AST schema.

The main executable is in `bin/analysis.ts`.  This script accepts a
set of commandline arguments specifying a "source corpus directory", a
"result directory", and arguments for one or more analysis methods to
run (along with options for each analysis).

It then performs each analysis on every file in the corpus in turn, dumping
the results in the "result directory".

Each analysis is implemented inside a specific `src/analysis/<ANALYSIS>.ts`
file.

The `src/lift_es6.ts` file lifts a javscript file into the typed schema.
It supports only ES5 features for now.. at least all the features required
to parse the files present in the `binjs-ref` repository's test data directory.

The `src/range_coder.ts` file is the range coder lifted from the external
`compressjs` project (see file for details).

The rest of the files should be relatively self-explanatory - helpers, loggers,
utilities of various sorts.
