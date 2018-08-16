
import * as assert from 'assert';

import {FieldType, FieldTypeNamed}
    from './field_types';

import {OrderedMap}
    from './ordered_map';

import * as util from './util';

/**
 * Global unique wrapper object for type names.
 */
const TYPE_NAMES = new Map<string, TypeName>();
export class TypeName {
    readonly name: string;

    private constructor(name: string) {
        this.name = name;
        Object.freeze(this);
    }

    static make(name: string): TypeName {
        let ftname = TYPE_NAMES.get(name);
        if (!ftname) {
            ftname = new TypeName(name);
            TYPE_NAMES.set(name, ftname);
        }
        return ftname;
    }

    prettyString(): string {
        return this.name;
    }
}

export type Value = null | boolean | number | string |
                    Instance | Array<any>;
export interface Instance {
    iface$: Iface;
}
export function isValue(x: any): boolean {
    return (x === null) ||
           (typeof(x) === 'boolean') ||
           (typeof(x) === 'number') ||
           (typeof(x) === 'string') ||
           ((typeof(x) === 'object') &&
                (x['iface$'] instanceof Iface)) ||
           // Don't do a deep check here.
           (x instanceof Array);
}

/**
 * A tree schema is specified as a collection of typedefs,
 * enums, and node declarations.
 *
 * One or more node declarations must be marked `Root`.
 * 
 */
export class TreeSchema {
    readonly decls: OrderedMap<TypeName, Declaration>;

    constructor(declArray: Array<Declaration>) {
        const decls = new OrderedMap<TypeName,
                                     Declaration>();
        for (let decl of declArray) {
            decls.set(decl.name, decl);
        }
        this.decls = decls;
        Object.freeze(this);
    }

    getDecl(tn: TypeName): Declaration {
        assert(this.decls.has(tn));
        return this.decls.get(tn);
    }

    /**
     * Dump this schema to a TypeScript file
     * in a form that exposes both a direct
     * coding API and associated reflective
     * data.
     */
    dumpTypescript(): string {
        const accum: Array<string> = [];

        accum.push(...[
            "/*** TypeScript API ***/",
            "",
            "/* Autogenerated in `tree_schema.ts.`",
            " * See `dumpTypescript` methods.",
            " */",
            "",
            "import * as assert from 'assert';",
            "import * as S from 'binast-schema';",
            "",
            "export type UInt = number;",
            "export type Int = number;",
            "export type Opt<T> = (null | T);",
            "export type Ro<T> = Readonly<T>;",
            "export type Arr<T> = Array<T>;",
            "export type RoArr<T> = ReadonlyArray<T>;",
            "",
            "",
            "abstract class BaseNode {",
            "}",
            "",
        ]);

        // Emit builder function for reflected schema.

        const builds: Array<string> = [];
        builds.push(...[
            "/*** Reflected Schema Builder ***/",
            "",
            "",
            "/* Helpers. */",
            "function TOpt(inner: S.FieldType)"
              + ": S.FieldTypeOpt {",
            "   return S.FieldTypeOpt.make(inner);",
            "}",
            "",
            "function TArray(inner: S.FieldType)"
              + ": S.FieldTypeArray {",
            "   return S.FieldTypeArray.make(inner);",
            "}",
            "",
            "function TUnion(inners: Array<S.FieldType>)"
              + ": S.FieldTypeUnion {",
            "   return S.FieldTypeUnion.make(" +
                        "Object.freeze(inners));",
            "}",
            "",
            "function TNamed(name: string)"
              + ": S.FieldTypeNamed {",
            "   return S.FieldTypeNamed.make(" +
                        "S.TypeName.make(name));",
            "}",
            "",
            "const TBool = S.FieldTypePrimitive.Bool;",
            "const TUint = S.FieldTypePrimitive.Uint;",
            "const TInt = S.FieldTypePrimitive.Int;",
            "const TF64 = S.FieldTypePrimitive.F64;",
            "const TStr = S.FieldTypePrimitive.Str;",
            "",
            "function mkEVN(enumName: string, name: string)"
              + ": S.EnumVariantName {",
            "   const tn = S.TypeName.make(enumName);",
            "   return S.EnumVariantName.make(tn, name);",
            "}",
            "",
            "export const ReflectedSchema = {",
        ]);
        for (let decl of this.decls.values()) {
            const buildDecl = new Array<string>();
            decl.dumpReflection(buildDecl);
            const buildDeclTabbed =
                buildDecl.map(d => '    ' + d);
            assert(buildDeclTabbed.length > 0);
            buildDeclTabbed.push(
                buildDeclTabbed.pop() + ',');
            builds.push(...buildDeclTabbed);
            builds.push('', '');
        }
        builds.push(...[
        `    get schema(): S.TreeSchema {`,
        `        if (!this['_schema']) {`,
        `            const d = `,
        `                new Array<S.Declaration>();`,
        ]);

        for (let decl of this.decls.values()) {
            const nm = decl.name.name;
            builds.push(...[
            `            d.push(ReflectedSchema.${nm});`
            ]);
        }

        builds.push(...[
        `            this['_schema'] = ` +
                                `new S.TreeSchema(d);`,
        `        }`,
        `        assert(this['_schema'] ` +
                            `instanceof S.TreeSchema);`,
        `        return this['_schema'] as S.TreeSchema;`,
        `    },`,
        `} // ReflectedSchema;`,
        ]);
        accum.push(...builds);
        accum.push("", "");

        // Typed definitions for nodes and enums
        // and typedefs.
        const defns: Array<string> = [];
        defns.push(...[
            "/*** Typed Interfaces ***/",
            "",
            // Typed definitions to follow.
        ]);
        for (let decl of this.decls.values()) {
            decl.dumpTypescript(defns);
            defns.push("", "");
        }
        accum.push(...defns);

        return accum.join('\n');
    }

    // Called by Named primitive type to resolve named
    // types.  For Ifaces and Enums it generates
    // Named types, and for typedefs it substitutes
    // the aliased type.
    resolveType(typeName: TypeName): FieldType {
        // Look up the type.
        return this.getDecl(typeName).intoFieldType();
    }

    prettyString(): string {
        const declArray = Array.from(this.decls.values());

        const declPretties =
            declArray.map(d => d.prettyString())
                     .map(s => util.shiftString(s, 2));

        return `Schema {\n${declPretties.join('\n\n')}\n}`;
    }
}

//
// Declarations
//
// Declarations are either a Typedef, Enum, or Iface,
// implemented by the respectively named concrete
// subclasses.
//

export enum DeclarationKind {
    Typedef = 'Typedef',
    Enum    = 'Enum',
    Iface   = 'Iface'
}

export abstract class Declaration {
    readonly name: TypeName;

    protected constructor(name: TypeName) {
        this.name = name;
    }

    abstract prettyString(): string;
    abstract intoFieldType(): FieldType;
    abstract dumpTypescript(defns: Array<string>);
    abstract dumpReflection(defns: Array<string>);
    abstract matchesValue(schema: TreeSchema, value: Value)
      : boolean;
    abstract prettyValue(schema: TreeSchema, value: Value,
                         out: Array<string>);
}


export class Typedef extends Declaration {
    readonly aliased: FieldType;

    constructor(name: TypeName, aliased: FieldType) {
        super(name);
        this.aliased = aliased;
        Object.freeze(this);
    }

    prettyString(): string {
        return `typedef ${this.name.prettyString()} =` +
               ` ${this.aliased.prettyString()};`;
    }

    intoFieldType(): FieldType {
        return this.aliased;
    }

    matchesValue(schema: TreeSchema, value: Value)
      : boolean
    {
        return this.aliased.matchesValue(schema, value);
    }

    prettyValue(schema: TreeSchema, value: Value,
                out: Array<string>)
    {
        assert(this.matchesValue(schema, value));
        this.aliased.prettyValue(schema, value, out);
    }

    dumpTypescript(defns: Array<string>) {
        const nm = this.name.name;

        // Declare the typedef directly.
        const tStr = this.aliased.typescriptString();
        defns.push(...[
            `export type ${nm} = ${tStr};`
        ]);
    }
    dumpReflection(builds: Array<string>) {
        const nm = this.name.name;
        const nmStr = JSON.stringify(nm);
        const cnmStr = JSON.stringify('c_' + nm);

        const typeNameEx = `S.TypeName.make(${nmStr})`;
        const aliasedEx = this.aliased.reflectedString();
        builds.push(...[
        `get ${nm}(): S.Typedef {`,
        `    if (!this[${cnmStr}]) {`,
        `        const typeName = ${typeNameEx};`,
        `        const aliased = ${aliasedEx};`,
        `        this[${cnmStr}] = new S.Typedef(`,
        `                           typeName, aliased)`,
        `    }`,
        `    assert(this[${cnmStr}] instanceof S.Typedef);`,
        `    return this[${cnmStr}] as S.Typedef;`,
        `},`,
        `get typeof_${nm}(): S.FieldType {`,
        `    return this.${nm}.aliased;`,
        `}`,
        ]);
    }
}


const ENUM_VARIANT_NAMES =
    new Map<string, EnumVariantName>();

export class EnumVariantName {
    readonly enumName: TypeName;
    readonly name: string;

    private constructor(enumName: TypeName, name: string) {
        this.enumName = enumName;
        this.name = name;
        Object.freeze(this);
    }

    static make(enumName: TypeName, name: string)
      : EnumVariantName
    {
        const key = EnumVariantName.makeKey(enumName.name,
                                            name);
        let evname = ENUM_VARIANT_NAMES.get(key);
        if (!evname) {
            evname = new EnumVariantName(enumName, name);
            ENUM_VARIANT_NAMES.set(key, evname);
        }
        return evname;
    }

    get fullName(): string {
        return `${this.enumName.name}_${this.name}`;
    }

    prettyString(): string {
        return this.fullName;
    }

    static makeKey(enumName: string, name: string): string {
        return `${enumName}_${name}`;
    }
}

export class EnumVariant {
    readonly enumName: TypeName;
    readonly name: EnumVariantName;
    readonly idx: number;
    readonly value: string;

    constructor(enumName, name, idx, value) {
        this.enumName = enumName;
        this.name = name;
        this.idx = idx;
        this.value = value;
        Object.freeze(this);
    }

    prettyString(): string {
        return `${this.enumName.name}.${this.name}`;
    }
}

export class Enum extends Declaration {
    readonly variants: ReadonlyArray<EnumVariant>;
    readonly variantMap: Map<string, number>;
    readonly valueMap: Map<string, number>;

    constructor(name: TypeName,
                variantNames: Array<EnumVariantName>,
                values: Array<string>)
    {
        assert(variantNames.length > 0);
        assert(variantNames.length === values.length);

        super(name);
        const variants: Array<EnumVariant> = new Array();

        this.variants = variants;
        this.variantMap = new Map();
        this.valueMap = new Map();

        variantNames.forEach((variantName, i: number) => {
            const value = values[i];
            const v = new EnumVariant(name, variantName,
                                      i, value);
            variants.push(v);
        });

        for (let i = 0; i < values.length; i++) {
            const name = variantNames[i];
            const value = values[i];
            this.variantMap.set(name.fullName, i);
            this.valueMap.set(value, i);
        }
        Object.freeze(variants);
        Object.freeze(this.variantMap);
        Object.freeze(this.valueMap);
        Object.freeze(this);
    }

    containsName(name: string): boolean {
        return this.variantMap.has(name);
    }

    lookupValue<E>(value: string): E {
        assert(this.valueMap.has(value));
        const idx = this.valueMap.get(value);

        assert(idx >= 0 && idx < this.variants.length);
        return (this.variants[idx] as any) as E;
    }

    prettyString(): string {
        const parts: Array<string> = [];
        this.valueMap.forEach((idx, value) => {
            const variant = this.variants[idx];
            const variantStr = variant.name.name;
            parts.push(`  ${variantStr} => '${value}'`);
        });
        return `enum ${this.name.prettyString()} {\n` +
               parts.join('\n') + '\n' +
               '};';
    }

    intoFieldType(): FieldType {
        return FieldTypeNamed.make(this.name);
    }

    matchesValue(schema: TreeSchema, value: Value)
      : boolean
    {
        return (typeof(value) === 'string') &&
               this.containsName(value);
    }

    prettyValue(schema: TreeSchema, value: Value,
                out: Array<string>)
    {
        assert(this.matchesValue(schema, value));
        out.push(value as string);
    }

    dumpTypescript(defns: Array<string>) {
        // On the interface, bind the typedef
        // name as a method yielding the Typedef
        // declaration.
        const nm = this.name.name;
        const refl = `ReflectedSchema.${nm}`;

        defns.push(`export enum ${nm} {`);
        for (let variant of this.variants) {
            const vname = variant.name.name;
            const vstr = variant.name.fullName;
            const vstrEx = JSON.stringify(vstr);
            defns.push(`   ${vname} = ${vstrEx},`);
        }
        defns.push(...[
            `} // enum ${nm}`,
            ``,
            `export function lift${nm}(s: string): ${nm} {`,
            `    switch (s) {`
        ]);
        for (let variant of this.variants) {
            const vvalX = JSON.stringify(variant.value);
            const vnm = variant.name.name;
            defns.push(...[
                `      case ${vvalX}: return ${nm}.${vnm};`,
            ]);
        }
        defns.push(...[
            `    }`,
            `    throw new Error("NOT ENUM!: " + s);`,
            `}`,
            ``,
        ]);
    }
    dumpReflection(builds: Array<string>) {
        const nm = this.name.name;
        const nmStr = JSON.stringify(nm);
        const cnmStr = JSON.stringify('c_' + nm);

        const typeNameEx = `S.TypeName.make(${nmStr})`;

        builds.push(...[
        `get ${nm}(): S.Enum {`,
        `    if (!this[${cnmStr}]) {`,
        `        const typeName = ${typeNameEx};`,
        `        const vnames: Array<S.EnumVariantName>`
          + ` = [];`,
        `        const vvals: Array<string> = [];`,
        ]);
        for (let v of this.variants) {
            const vnStr = JSON.stringify(v.name.name);
            const evnStr = `mkEVN(${nmStr}, ${vnStr})`;
            const vStr = JSON.stringify(v.value);
            builds.push('    '.repeat(2) +
                `vnames.push(${evnStr})`);
            builds.push('    '.repeat(2) +
                `vvals.push(${vStr});`);
            builds.push('');
        }
        builds.push(...[
        `        this[${cnmStr}] = new S.Enum(`
                      + `typeName, vnames, vvals);`,
        `    }`,
        `    assert(this[${cnmStr}] instanceof S.Enum);`,
        `    return this[${cnmStr}] as S.Enum;`,
        `},`,
        `get typeof_${nm}(): S.FieldType {`,
        `    const fieldName = this.${nm}.name;`,
        `    return S.FieldTypeNamed.make(fieldName);`,
        `}`,
        ]);
    }
}


export class Iface extends Declaration {
    readonly fields: ReadonlyArray<IfaceField>;
    readonly isNode: boolean;

    constructor(name: TypeName,
                fields: Array<IfaceField>,
                isNode: boolean)
    {
        super(name);
        this.fields = Object.freeze(fields);
        this.isNode = isNode;
        Object.freeze(this);
    }

    prettyString() {
        return `iface ${this.name.prettyString()} {\n` +
             this.fields.map(f => f.prettyString())
                        .join("\n") + "\n" +
             `}`;
    }

    intoFieldType(): FieldType {
        return FieldTypeNamed.make(this.name);
    }

    prettyInstance(schema: TreeSchema, inst: Instance,
                   out: Array<string>)
    {
        assert(inst.iface$ === this);

        out.push(`${this.name.name} {`);

        let npushed: number = 0;
        
        // Retrieve each field.
        for (let field of this.fields) {
            const fty = field.ty;
            const fval = inst[field.name] as Value;
            assert(isValue(fval));
            const fvalStrs = new Array<string>();
            fty.prettyValue(schema, fval, fvalStrs);
            assert(fvalStrs.length > 0);
            if (fvalStrs.length == 1 &&
                fvalStrs[0].length < 30)
            {
                out.push(`  ${field.name}: ` +
                            fvalStrs[0]);
                npushed++;
            } else {
                const first = fvalStrs.shift();
                const tabbed = fvalStrs.map(s => {
                    return '  ' + s;
                });
                const tabbedFirst =
                    `  ${field.name}: ${first}`;
                out.push(tabbedFirst, ...tabbed);
                npushed += 1 + tabbed.length;
            }
        }

        let trailer: string = '';
        if (npushed > 10) {
            trailer = ` // ${this.name.name}`
        }
        out.push(`}${trailer}`);
    }

    matchesValue(schema: TreeSchema, value: Value)
      : boolean
    {
        return (typeof(value) === 'object') &&
               (value !== null) &&
               (value['iface$'] === this);
    }

    prettyValue(schema: TreeSchema, value: Value,
                out: Array<string>)
    {
        assert(this.matchesValue(schema, value));
        this.prettyInstance(schema, value as Instance, out);
        out.push('');
    }


    dumpTypescript(defns: Array<string>) {
        // On the interface, bind the typedef
        // name as a method yielding the Typedef
        // declaration.
        const nm = this.name.name;

        this.dumpTypescriptInterface(defns);
        defns.push('');
        this.dumpTypescriptInstance(defns);

    }

    dumpTypescriptInterface(defns: Array<string>) {
        const nm = this.name.name;

        defns.push(`export interface I_${nm} {`);
        for (let field of this.fields) {
            const fnm = field.name;
            const tstr = field.ty.typescriptString();
            defns.push(`    readonly ${fnm}: ${tstr};`);
        }
        defns.push(`} // I_${nm}`);
    }

    dumpTypescriptInstance(defns: Array<string>) {
        const nm = this.name.name;

        defns.push(`export class ${nm}`);
        if (this.isNode) {
            defns.push(`  extends BaseNode`);
        }
        defns.push(...[
            `  implements S.Instance`,
            `{`,
            `    readonly data$: Ro<I_${nm}>;`,
        ]);

        defns.push(...[
            ``,
            `    private constructor(data: Ro<I_${nm}>) {`,
        ]);
        // If extending Node, call super().
        if (this.isNode) {
            defns.push(`    super();`);
        }
        const ifaceEx = `ReflectedSchema.${nm}`;
        defns.push(...[
            `        this.data$ = Object.freeze(data);`,
            `        Object.freeze(this);`,
            `    }`,
            ``,
        ]);

        // Static constructor definition.
        defns.push(...[
            `    get iface$(): S.Iface {`,
            `        return ReflectedSchema.${nm};`,
            `    }`,
            `    static make(data: Ro<I_${nm}>) {`,
            `        return new ${nm}(data);`,
            `    }`,
            ``,
        ]);

        // Accessor method definition.
        for (let field of this.fields) {
            const fnm = field.name;
            const tstr = field.ty.typescriptString();
            defns.push(...[
                `    get ${fnm}(): ${tstr} {`,
                `       return this.data$.${fnm};`,
                `    }`,
            ]);
        }

        // End.
        defns.push(...[
            `}`,
        ]);
    }

    dumpReflection(builds: Array<string>) {
        const nm = this.name.name;
        const nmStr = JSON.stringify(nm);
        const cnmStr = JSON.stringify('c_' + nm);

        const typeNameEx = `S.TypeName.make(${nmStr})`;
        const isNodeEx = this.isNode ? `true` : `false`;

        builds.push(...[
        `get ${nm}(): S.Iface {`,
        `    if (!this[${cnmStr}]) {`,
        `        const typeName = ${typeNameEx};`,
        `        const fields: Array<S.IfaceField> = [`,
        ]);
        for (let f of this.fields) {
            const ftEx = f.ty.reflectedString();
            const fnStr = JSON.stringify(f.name);
            const isLazyEx = f.isLazy ? 'true' : 'false';
            builds.push(...[
            `        new S.IfaceField(`,
            `            /* name = */ ${fnStr},`,
            `            /* ty = */ ${ftEx},`,
            `            /* isLazy = */ ${isLazyEx}),`,
            ]);
        }
        builds.push(...[
        `        ];`,
        `        this[${cnmStr}] = new S.Iface(`
                      + `typeName, fields, ${isNodeEx});`,
        `    }`,
        `    assert(this[${cnmStr}] instanceof S.Iface);`,
        `    return this[${cnmStr}] as S.Iface;`,
        `},`,
        `get typeof_${nm}(): S.FieldType {`,
        `    const fieldName = this.${nm}.name;`,
        `    return S.FieldTypeNamed.make(fieldName);`,
        `}`,
        ]);
    }
}

export class IfaceField {
    readonly name: string;
    readonly ty: FieldType;
    readonly isLazy: boolean;

    constructor(name: string,
                ty: FieldType,
                isLazy?: boolean)
    {
        this.name = name;
        this.ty = ty;
        this.isLazy = !!isLazy;
        Object.freeze(this);
    }

    prettyString() {
        const attrPrefix = this.isLazy ? '[Lazy] ' : '';
        const name = this.name;
        const tyStr = this.ty.prettyString();
        return `  ${attrPrefix}${name}: ${tyStr};`;
    }
}
