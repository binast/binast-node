
import * as assert from 'assert';

import {OrderedMap} from './ordered_map';
import {OrderedSet} from './ordered_set';
import * as util from './util';

/**
 * A tree schema is specified as a collection of typedefs,
 * enums, and node declarations.
 *
 * One or more node declarations must be marked `Root`.
 * 
 */
export class TreeSchema {
    readonly decls: OrderedMap<TypeName, Declaration>;

    constructor(decls: OrderedMap<TypeName, Declaration>) {
        this.decls = decls;
        Object.freeze(this);
    }

    getDecl(tn: TypeName): Declaration {
        assert(this.decls.has(tn));
        return this.decls.get(tn);
    }

    /**
     * Produce a new, normalized tree schema.
     */
    normalize(): TreeSchema {
        const newDecls =
            new OrderedMap<TypeName, Declaration>();

        // First, resolve all references to typenames
        // down to primitive, enum, or iface
        // references.
        this.resolveNames(newDecls);

        // Re-order the normalized decls by the
        // same order they occured in the old schema.
        const ordDecls =
            new OrderedMap<TypeName, Declaration>();
        for (let decl of this.decls.values()) {
            const name = decl.name;
            ordDecls.set(name, newDecls.get(name));
        }

        return new TreeSchema(ordDecls);
    }

    private resolveNames(
        newDecls: OrderedMap<TypeName, Declaration>)
    {
        for (let decl of this.decls.values()) {
            this.resolveDecl(decl, newDecls);
        }
    }

    private resolveDecl(decl: Declaration,
            newDecls: OrderedMap<TypeName, Declaration>)
    {
        if (!newDecls.has(decl.name)) {
            newDecls.set(decl.name,
                decl.resolveNames(this, newDecls));
        }
    }

    resolveType(typeName: TypeName,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldType
    {
        // Look up the type.
        const decl = this.getDecl(typeName);

        // Ifaces and enums just produce named types.
        if ((decl instanceof Iface) ||
            (decl instanceof Enum))
        {
            return FieldTypeNamed.make(typeName);
        }

        assert(decl instanceof Typedef);
        this.resolveDecl(decl, newDecls);

        let newDecl = newDecls.get(typeName);
        return (newDecl as Typedef).aliased;
    }

    prettyString(): string {
        const declArray = Array.from(this.decls.values());

        const declPretties =
            declArray.map(d => d.prettyString())
                     .map(s => util.shiftString(s, 2));

        return `Schema {\n${declPretties.join('\n\n')}\n}`;
    }
}

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

    abstract get declKind(): DeclarationKind;
    abstract prettyString(): string;
    abstract resolveNames(
            treeSchema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : Declaration;
}

export class Typedef extends Declaration {
    readonly aliased: FieldType;

    constructor(name: TypeName, aliased: FieldType) {
        super(name);
        this.aliased = aliased;
        Object.freeze(this);
    }

    get declKind(): DeclarationKind {
        return DeclarationKind.Typedef;
    }

    prettyString(): string {
        return `typedef ${this.name.prettyString()} =` +
               ` ${this.aliased.prettyString()};`;
    }

    resolveNames(
        treeSchema: TreeSchema,
        newDecls: OrderedMap<TypeName, Declaration>)
      : Typedef
    {
        const resolved = this.aliased.resolveNames(
                                treeSchema, newDecls);
        return new Typedef(this.name, resolved);
    }
}

export class Enum extends Declaration {
    readonly variants: OrderedSet<string>;
    readonly variantIdxMap: Map<string, number>;
    readonly valueMap: Map<string, string>;

    constructor(name: TypeName,
                variants: OrderedSet<string>,
                values: OrderedSet<string>)
    {
        assert(variants.size > 0);
        assert(variants.size === values.size);

        super(name);
        this.variants = variants;
        this.variantIdxMap = new Map();
        this.valueMap = new Map();

        const variantsArray = Array.from(variants);
        const valuesArray = Array.from(values);

        for (let i = 0; i < variantsArray.length; i++) {
            let variant = variantsArray[i];
            let value = valuesArray[i];
            this.variantIdxMap.set(variant, i);
            this.valueMap.set(value, variant);
        }
        Object.freeze(this);
    }

    get declKind(): DeclarationKind {
        return DeclarationKind.Enum;
    }

    prettyString(): string {
        const parts: Array<string> = [];
        this.valueMap.forEach((variant, value) => {
            parts.push(`  ${variant} => '${value}'`);
        });
        return `enum ${this.name.prettyString()} {\n` +
               parts.join('\n') + '\n' +
               '};';
    }

    resolveNames(
        treeSchema: TreeSchema,
        newDecls: OrderedMap<TypeName, Declaration>)
      : Enum
    {
        return this;
    }
}

export class Iface extends Declaration {
    readonly fields: OrderedMap<string, IfaceField>

    constructor(name: TypeName,
                fields: OrderedMap<string, IfaceField>)
    {
        super(name);
        this.fields = fields;
        Object.freeze(this);
    }

    get declKind(): DeclarationKind {
        return DeclarationKind.Iface;
    }

    prettyString() {
        return `iface ${this.name.prettyString()} {\n` +
             Array.from(this.fields.values())
                  .map(f => f.prettyString())
                  .join('\n') + '\n' +
             '}';
    }

    resolveNames(
        treeSchema: TreeSchema,
        newDecls: OrderedMap<TypeName, Declaration>)
      : Iface
    {
        const rfs = new OrderedMap<string, IfaceField>();
        for (let f of this.fields.values()) {
            rfs.set(f.name,
                f.resolveNames(treeSchema, newDecls));
        }
        return new Iface(this.name, rfs);
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

    resolveNames(treeSchema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : IfaceField
    {
        const rty = this.ty.resolveNames(treeSchema,
                                         newDecls);
        return new IfaceField(this.name, rty, this.isLazy);
    }
}

const TYPE_NAMES = new Map<string, TypeName>();
export class TypeName {
    readonly name: string;

    private constructor(name: string)
    {
        this.name = name;
        Object.freeze(this);
    }

    static make(name: string)
      : TypeName
    {
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

// A FieldType is one of:
//  1. A primitive type
//      bool, uint, int, f64, str, null
//  2. A reference to an enum or iface.
//  3. A union of 2+ distinct field types (T|U|V..)
//  4. An optional of a given type (?T)
//  5. An array of a given type. ([T])

export enum FieldTypeKind {
    Primitive, Named, Union, Opt, Array
};

let NEXT_TYPE_ID: number = 1;
const TYPE_CACHE: Map<string, FieldType> = new Map();

export abstract class FieldType {
    readonly typeId: number;

    abstract prettyString(): string;
    abstract kind(): FieldTypeKind;
    abstract resolveNames(treeSchema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldType;

    protected constructor(typeId: number) {
        this.typeId = typeId;
    }

    protected static nextId(): number {
        return NEXT_TYPE_ID++;
    }
    protected static lookup(key: string): FieldType|null {
        return TYPE_CACHE.get(key) || null;
    }
    protected static lookupOr<T extends FieldType>(
            key: string,
            f: (number) => T)
      : T
    {
        const existing = TYPE_CACHE.get(key);
        if (existing) {
            return existing as T;
        }
        const created = f(this.nextId());
        TYPE_CACHE.set(key, created);
        return created;
    }
    protected static register(key: string, ty: FieldType) {
        assert(!TYPE_CACHE.has(key));
        return TYPE_CACHE.set(key, ty);
    }

    isKind(k: FieldTypeKind): boolean {
        return this.kind() === k;
    }

    isPrimitive(): boolean {
        return this.isKind(FieldTypeKind.Primitive);
    }
    isUnion(): boolean {
        return this.isKind(FieldTypeKind.Union);
    }
    isOpt(): boolean {
        return this.isKind(FieldTypeKind.Opt);
    }
    isArray(): boolean {
        return this.isKind(FieldTypeKind.Array);
    }
}

export class FieldTypePrimitive extends FieldType {
    readonly name: string;

    private constructor(typeId: number, name: string) {
        super(typeId);
        this.name = name;
        Object.freeze(this);
    }

    static make(name: string): FieldTypePrimitive {
        const key = FieldTypePrimitive.typeKey(name);
        return FieldType.lookupOr(key, (id: number) => {
            return new FieldTypePrimitive(id, name);
        });
    }

    kind(): FieldTypeKind {
        return FieldTypeKind.Primitive;
    }
    prettyString(): string {
        return this.name;
    }
    resolveNames(treeSchema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldTypePrimitive
    {
        return this;
    }

    static typeKey(name: string): string {
        return `prim(${name})`;
    }

    static get Bool(): FieldTypePrimitive {
        return TN_BOOL;
    }
    static get Uint(): FieldTypePrimitive {
        return TN_UINT;
    }
    static get Int(): FieldTypePrimitive {
        return TN_INT;
    }
    static get F64(): FieldTypePrimitive {
        return TN_F64;
    }
    static get Str(): FieldTypePrimitive {
        return TN_STR;
    }
}

const TN_BOOL = FieldTypePrimitive.make('bool');
const TN_UINT = FieldTypePrimitive.make('uint');
const TN_INT = FieldTypePrimitive.make('int');
const TN_F64 = FieldTypePrimitive.make('f64');
const TN_STR = FieldTypePrimitive.make('str');

export class FieldTypeNamed extends FieldType {
    readonly name: TypeName;

    constructor(typeId: number, name: TypeName)
    {
        super(typeId);
        this.name = name;
        Object.freeze(this);
    }

    static make(name: TypeName): FieldTypeNamed
    {
        // declKind is not used in the TypeKey.
        const key = FieldTypeNamed.typeKey(name);
        return FieldType.lookupOr(key, (id: number) => {
            return new FieldTypeNamed(id, name);
        });
    }
    resolveNames(treeSchema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldType
    {
        return treeSchema.resolveType(this.name, newDecls);
    }

    kind(): FieldTypeKind {
        return FieldTypeKind.Named;
    }
    prettyString(): string {
        return this.name.prettyString();
    }
    static typeKey(name: TypeName): string {
        return `named(${name.name})`;
    }
}

export class FieldTypeUnion extends FieldType {
    readonly variants: ReadonlyArray<FieldType>;

    constructor(typeId: number,
                variants: ReadonlyArray<FieldType>)
    {
        super(typeId);
        this.variants = variants;
        Object.freeze(this);
    }

    static make(variants: ReadonlyArray<FieldType>)
      : FieldTypeUnion
    {
        const key = FieldTypeUnion.typeKey(variants);
        return FieldType.lookupOr(key, (id: number) => {
            return new FieldTypeUnion(id, variants);
        });
    }

    kind(): FieldTypeKind {
        return FieldTypeKind.Union;
    }
    prettyString(): string {
        let mstr = this.variants.map(m => m.prettyString());
        return `Union<${mstr.join(' | ')}>`;
    }
    static typeKey(variants: ReadonlyArray<FieldType>)
      : string
    {
        let ids = variants.map(m => m.typeId);
        return `union(${ids.join(',')})`
    }

    resolveNames(treeSchema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldType
    {
        const newVariants = new Array<FieldType>();
        let wrapOpt: boolean = false;

        for (let variant of this.variants) {
            // resolve the variant first.
            let rv = variant.resolveNames(treeSchema,
                                          newDecls);

            // While the inner type is an opt, set
            // wrapOpt = true and unwrap.
            while (rv instanceof FieldTypeOpt) {
                wrapOpt = true;
                rv = rv.inner;
            }

            // If the type is now a union, then
            // fold its contents into newVariants.
            if (rv instanceof FieldTypeUnion) {
                for (let terminalRv of rv.variants) {
                    newVariants.push(terminalRv);
                }
            } else {
                // Must either be an array, named,
                // or primitive.  Add it singularly.
                assert((rv instanceof FieldTypeArray) ||
                       (rv instanceof FieldTypeNamed) ||
                       (rv instanceof FieldTypePrimitive));
                newVariants.push(rv);
            }
        }

        let ft: FieldType = FieldTypeUnion.make(
                    Object.freeze(newVariants));
        if (wrapOpt) {
            ft = FieldTypeOpt.make(ft);
        }
        return ft;
    }
}

export class FieldTypeOpt extends FieldType {
    readonly inner: FieldType;

    constructor(typeId: number, inner: FieldType) {
        super(typeId);
        this.inner = inner;
        Object.freeze(this);
    }

    static make(inner: FieldType): FieldTypeOpt {
        const key = FieldTypeOpt.typeKey(inner);
        return FieldType.lookupOr(key, (id: number) => {
            return new FieldTypeOpt(id, inner);
        });
    }

    kind(): FieldTypeKind {
        return FieldTypeKind.Opt;
    }
    prettyString(): string {
        return `Opt<${this.inner.prettyString()}>`;
    }
    static typeKey(inner: FieldType): string {
        return `opt(${inner.typeId})`;
    }

    resolveNames(treeSchema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldType
    {
        return FieldTypeOpt.make(
            this.inner.resolveNames(treeSchema, newDecls));
    }
}

export class FieldTypeArray extends FieldType {
    readonly inner: FieldType;

    constructor(typeId: number, inner: FieldType) {
        super(typeId);
        this.inner = inner;
        Object.freeze(this);
    }

    static make(inner: FieldType): FieldTypeArray {
        const key = FieldTypeArray.typeKey(inner);
        return FieldType.lookupOr(key, (id: number) => {
            return new FieldTypeArray(id, inner);
        });
    }

    kind(): FieldTypeKind {
        return FieldTypeKind.Array;
    }
    prettyString(): string {
        return `Array<${this.inner.prettyString()}>`;
    }
    static typeKey(inner: FieldType): string {
        return `array(${inner.typeId})`;
    }

    resolveNames(treeSchema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldType
    {
        return FieldTypeArray.make(
            this.inner.resolveNames(treeSchema, newDecls));
    }
}
