
import * as assert from 'assert';

import {OrderedMap} from './ordered_map';
import {TreeSchema, TypeName, Declaration, Iface, Enum}
    from './tree_schema';

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
    abstract resolveNames(schema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldType;
    abstract typescriptString(): string;
    abstract reflectedString(): string;
    abstract matchesValue(schema: TreeSchema, value: any)
              : boolean;
    abstract prettyValue(schema: TreeSchema, value: any,
                         out: Array<string>);

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
    resolveNames(schema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldTypePrimitive
    {
        return this;
    }
    matchesValue(schema: TreeSchema, value: any): boolean {
        switch (this) {
          case TN_BOOL:
            return typeof(value) === 'boolean';
          case TN_UINT:
            return Number.isInteger(value) && (value >= 0);
          case TN_INT:
            return Number.isInteger(value);
          case TN_F64:
            return typeof(value) === 'number';
          case TN_STR:
            return typeof(value) === 'string';
        }
        throw new Error(`Unknown primitive ${this.name}`);
    }
    prettyValue(schema: TreeSchema, value: any,
                out: Array<string>)
    {
        switch (this) {
          case TN_BOOL: out.push(`Bool(${value})`); return;
          case TN_UINT: out.push(`Uint(${value})`); return;
          case TN_INT: out.push(`Int(${value})`); return;
          case TN_F64: out.push(`F64(${value})`); return;
          case TN_STR:
            out.push(`Str(${JSON.stringify(value)})`);
            return;
        }
        throw new Error(`Unknown primitive ${this.name}`);
    }

    typescriptString(): string {
        switch (this) {
          case TN_BOOL: return 'boolean';
          case TN_UINT: return 'UInt';
          case TN_INT: return 'Int';
          case TN_F64: return 'number';
          case TN_STR: return 'string';
        }
        throw new Error(`Unknown primitive ${this.name}`);
    }
    reflectedString(): string {
        switch (this) {
          case TN_BOOL: return 'TBool';
          case TN_UINT: return 'TUint';
          case TN_INT: return 'TInt';
          case TN_F64: return 'TF64';
          case TN_STR: return 'TStr';
        }
        throw new Error(`Unknown primitive ${this.name}`);
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
        const key = FieldTypeNamed.typeKey(name);
        return FieldType.lookupOr(key, (id: number) => {
            return new FieldTypeNamed(id, name);
        });
    }
    resolveNames(schema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldType
    {
        return schema.resolveType(this.name, newDecls);
    }
    typescriptString(): string {
        return this.name.name;
    }
    reflectedString(): string {
        const tstr = JSON.stringify(this.name.name);
        return `TNamed(${tstr})`;
    }
    matchesValue(schema: TreeSchema, value: any): boolean {
        const decl = schema.getDecl(this.name);
        if (decl instanceof Iface) {
            return (typeof(value) === 'object')
                 && (value !== null)
                 && (value['iface$'] === decl);
        } else if (decl instanceof Enum) {
            return typeof(value) == 'string' &&
                   decl.containsName(value as string);
        }
        throw new Error(`Unknown prim ${this.name.name}`);
    }
    prettyValue(schema: TreeSchema, value: any,
                out: Array<string>)
    {
        const decl = schema.getDecl(this.name);
        if (decl instanceof Iface) {
            assert(this.matchesValue(schema, value),
                   `Iface failed matchesValue: ` +
                        JSON.stringify(value));
            (value['iface$'] as Iface).prettyInstance(
                schema, value, out);
            out.push('');
            return;
        } else if (decl instanceof Enum) {
            assert(this.matchesValue(schema, value),
                   `Field ${decl.name.name} failed matchesValue: ` +
                        JSON.stringify(value));
            out.push(value);
            return;
        }
        throw new Error(
            `Unknown named ${this.name.name}: ` +
            JSON.stringify(value));
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

    matchesValue(schema: TreeSchema, value: any): boolean {
        return this.variants.some(v => {
            return v.matchesValue(schema, value);
        });
    }
    prettyValue(schema: TreeSchema, value: any,
                out: Array<string>)
    {
        // Check every constituent type.
        for (let v of this.variants) {
            if (v.matchesValue(schema, value)) {
                v.prettyValue(schema, value, out);
                return;
            }
        }
        throw new Error(`Union not matched: ${value}`);
    }

    resolveNames(schema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldType
    {
        const newVariants = new Array<FieldType>();
        let wrapOpt: boolean = false;

        for (let variant of this.variants) {
            // resolve the variant first.
            let rv = variant.resolveNames(schema,
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
    typescriptString(): string {
        const varStrs = this.variants.map(v => {
            return v.typescriptString();
        });
        return `(${varStrs.join(' | ')})`;
    }
    reflectedString() {
        return `TUnion([` +
                this.variants.map(v => v.reflectedString())
                            .join(', ') + '])';
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

    matchesValue(schema: TreeSchema, value: any): boolean {
        return (value === null) ||
               this.inner.matchesValue(schema, value);
    }
    prettyValue(schema: TreeSchema, value: any,
                out: Array<string>)
    {
        assert(this.matchesValue(schema, value));
        if (value === null) {
            out.push('null');
        } else {
            this.inner.prettyValue(schema, value, out);
        }
    }

    resolveNames(schema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldType
    {
        return FieldTypeOpt.make(
            this.inner.resolveNames(schema, newDecls));
    }
    typescriptString(): string {
        const innerStr = this.inner.typescriptString();
        return `Opt<${innerStr}>`;
    }
    reflectedString() {
        let innerStr = this.inner.reflectedString();
        return `TOpt(${innerStr})`;
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

    matchesValue(schema: TreeSchema, value: any): boolean {
        return (value instanceof Array) &&
           (value.every(
                v => this.inner.matchesValue(schema, v)));
    }
    prettyValue(schema: TreeSchema, value: any,
                out: Array<string>)
    {
        assert(this.matchesValue(schema, value));
        const arrays = new Array<Array<string>>();
        for (let e of (value as Array<any>)) {
            const arr = new Array<string>();
            this.inner.prettyValue(schema, e, arr);
            arrays.push(arr.map(s => ('  ' + s)));
        }
        // Check for small definition.
        if (arrays.every(arr => (arr.length === 1))) {
            const j = arrays.map(arr => arr[0]).join(', ');
            if (j.length < 40) {
                out.push(`[${j}]`);
                return;
            }
        }

        out.push('[');
        for (let arr of arrays) {
            out.push(...arr);
        }
        out.push(']');
    }

    resolveNames(schema: TreeSchema,
            newDecls: OrderedMap<TypeName, Declaration>)
      : FieldType
    {
        return FieldTypeArray.make(
            this.inner.resolveNames(schema, newDecls));
    }

    typescriptString(): string {
        const innerStr = this.inner.typescriptString();
        return `RoArr<${innerStr}>`;
    }
    reflectedString() {
        let innerStr = this.inner.reflectedString();
        return `TArray(${innerStr})`;
    }
}
