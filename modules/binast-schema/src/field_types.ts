
import * as assert from 'assert';

import {OrderedMap} from './ordered_map';
import {TreeSchema, TypeName, Declaration, Iface, Enum,
        Identifier, Value, Instance}
    from './tree_schema';
import {jsonStr} from './util';

// A FieldType is one of:
//  1. A primitive type
//      bool, uint, int, f64, str, null
//  2. A reference to an enum or iface.
//  3. A union of 2+ distinct field types (T|U|V..)
//  4. An optional of a given type (?T)
//  5. An array of a given type. ([T])

export enum FieldTypeKind {
    Primitive, Ident, Named, Union, Array,
    Iface, Enum
};

let NEXT_TYPE_ID: number = 1;
const TYPE_CACHE: Map<string, FieldType> = new Map();

export abstract class FieldType {
    readonly typeId: number;

    protected constructor(typeId: number) {
        this.typeId = typeId;
    }

    abstract prettyString(): string;
    abstract kind(): FieldTypeKind;
    abstract typescriptString(): string;
    abstract reflectedString(): string;
    abstract matchesValue(schema: TreeSchema, value: Value)
              : boolean;

    abstract flattenImpl(schema: TreeSchema)
      : Array<TerminalFieldType>;

    flatten(schema: TreeSchema): TypeSet {
        return TypeSet.make(this.flattenImpl(schema));
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
}

export class TypeSet {
    readonly tys: ReadonlyArray<TerminalFieldType>;

    private constructor(
        tys: ReadonlyArray<TerminalFieldType>)
    {
        this.tys = tys;
    }

    static make(tys: ReadonlyArray<TerminalFieldType>) {
        return new TypeSet(tys);
    }

    get size(): number {
        return this.tys.length;
    }

    resolveType(schema: TreeSchema, value: Value)
      : ResolvedType
    {
        let result: ResolvedType|null = null;
        for (let i = 0; i < this.tys.length; i++) {
            const ty = this.tys[i];
            if (ty.matchesValue(schema, value)) {
                assert(result === null,
                   `Duplicate matching types for value`);
                result = new ResolvedType(this, ty, i);
            }
        }
        return result;
    }
}

export class ResolvedType {
    readonly typeSet: TypeSet;
    readonly ty: TerminalFieldType;
    readonly index: number;

    constructor(typeSet: TypeSet,
                ty: TerminalFieldType,
                index: number)
    {
        this.typeSet = typeSet;
        this.ty = ty;
        this.index = index;
        Object.freeze(this);
    }

    prettyString(): string {
        const tyStr = this.ty.prettyString();
        const index = this.index;
        const total = this.typeSet.size
        return `Resolved ${tyStr} - ${index}/${total}`;
    }
}

export abstract class TerminalFieldType
  extends FieldType
{
    constructor(typeId: number) {
        super(typeId);
    }

    // And a trivial flatten
    flattenImpl(schema: TreeSchema)
      : Array<TerminalFieldType>
    {
        // Array types are terminal.
        return [this];
    }
}

export class FieldTypePrimitive
  extends TerminalFieldType
{
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
    matchesValue(schema: TreeSchema, value: Value)
      : boolean
    {
        switch (this) {
          case TN_NULL:
            return value === null;
          case TN_BOOL:
            return typeof(value) === 'boolean';
          case TN_UINT:
            return (typeof(value) === 'number') &&
                   Number.isInteger(value) &&
                   (value >= 0);
          case TN_INT:
            return (typeof(value) === 'number') &&
                   Number.isInteger(value);
          case TN_F64:
            return typeof(value) === 'number';
          case TN_STR:
            return typeof(value) === 'string';
        }
        throw new Error(`Unknown primitive ${this.name}`);
    }

    typescriptString(): string {
        switch (this) {
          case TN_NULL: return 'null';
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
          case TN_NULL: return 'TNull';
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
    static get Null(): FieldTypePrimitive {
        return TN_NULL;
    }
}

const TN_BOOL = FieldTypePrimitive.make('bool');
const TN_UINT = FieldTypePrimitive.make('uint');
const TN_INT = FieldTypePrimitive.make('int');
const TN_F64 = FieldTypePrimitive.make('f64');
const TN_STR = FieldTypePrimitive.make('str');
const TN_NULL = FieldTypePrimitive.make('null');

export class FieldTypeIdent
  extends TerminalFieldType
{
    readonly tag: string;

    private constructor(typeId: number, tag: string) {
        super(typeId);
        this.tag = tag;
        Object.freeze(this);
    }

    static make(tag: string): FieldTypeIdent {
        const key = FieldTypeIdent.typeKey(tag);
        return FieldType.lookupOr(key, (id: number) => {
            return new FieldTypeIdent(id, tag);
        });
    }

    kind(): FieldTypeKind {
        return FieldTypeKind.Ident;
    }
    prettyString(): string {
        return `id(${this.tag})`;
    }
    matchesValue(schema: TreeSchema, value: Value)
      : boolean
    {
        return value instanceof Identifier;
    }

    typescriptString(): string {
        return 'S.Identifier';
    }
    reflectedString(): string {
        return `TIdent(${jsonStr(this.tag)})`;
    }

    static typeKey(tag: string): string {
        return `ident(${tag})`;
    }
}

export class FieldTypeNamed extends FieldType {
    readonly name: TypeName;

    constructor(typeId: number, name: TypeName) {
        super(typeId);
        this.name = name;
        Object.freeze(this);
    }

    static make(name: TypeName): FieldTypeNamed {
        const key = FieldTypeNamed.typeKey(name);
        return FieldType.lookupOr(key, (id: number) => {
            return new FieldTypeNamed(id, name);
        });
    }
    typescriptString(): string {
        return this.name.name;
    }
    reflectedString(): string {
        const tstr = JSON.stringify(this.name.name);
        return `TNamed(${tstr})`;
    }
    matchesValue(schema: TreeSchema, value: Value)
      : boolean
    {
        const decl = schema.getDecl(this.name);
        return decl.matchesValue(schema, value);
    }
    flattenImpl(schema: TreeSchema)
      : Array<TerminalFieldType>
    {
        // Peek through the typedef and flatten the
        // underlying type.
        const decl = schema.getDecl(this.name);
        return decl.flattennedType(schema);
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

    static makeNullable(ty: FieldType): FieldTypeUnion
    {
        return FieldTypeUnion.make(Object.freeze([
            FieldTypePrimitive.Null,
            ty
        ]));
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

    matchesValue(schema: TreeSchema, value: Value)
      : boolean
    {
        return this.variants.some(v => {
            return v.matchesValue(schema, value);
        });
    }
    flattenImpl(schema: TreeSchema)
      : Array<TerminalFieldType>
    {
        // Flatten the constituent types.

        let flats = new Array<TerminalFieldType>();
        let flatSet = new Set<TerminalFieldType>();
        let hasNull: boolean = false;

        for (let variant of this.variants) {
            // Get array of underlying flattened
            // types and promote it.
            let subFlats = variant.flattenImpl(schema);
            for (let sf of subFlats) {
                if (sf === FieldTypePrimitive.Null) {
                    hasNull = true;
                    continue;
                }
                if (! flatSet.has(sf)) {
                    flats.push(sf);
                    flatSet.add(sf);
                }
            }
        }
        if (hasNull) {
            flats.unshift(FieldTypePrimitive.Null);
        }
        return flats;
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

export class FieldTypeArray
  extends TerminalFieldType
{
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

    matchesValue(schema: TreeSchema, value: Value)
      : boolean
    {
        return (value instanceof Array) &&
           (value.every(
                v => this.inner.matchesValue(
                    schema,
                    v as Value)));
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

export class FieldTypeIface
  extends TerminalFieldType
{
    readonly name: TypeName;

    constructor(typeId: number, name: TypeName) {
        super(typeId);
        this.name = name;
        Object.freeze(this);
    }

    static make(name: TypeName): FieldTypeIface {
        const key = FieldTypeIface.typeKey(name);
        return FieldType.lookupOr(key, (id: number) => {
            return new FieldTypeIface(id, name);
        });
    }

    ifaceName(): string {
        return this.name.name;
    }

    kind(): FieldTypeKind {
        return FieldTypeKind.Iface;
    }
    prettyString(): string {
        return `Iface<${this.ifaceName()}>`;
    }
    static typeKey(name: TypeName): string {
        return `array(${name.name})`;
    }

    matchesValue(schema: TreeSchema, value: Value)
      : boolean
    {
        const iface = schema.getDecl(this.name);
        assert(iface instanceof Iface);
        return iface.matchesValue(schema, value);
    }

    typescriptString(): string {
        return this.ifaceName();
    }
    reflectedString() {
        return `ReflectedSchema.${this.ifaceName()}`;
    }
}

export class FieldTypeEnum
  extends TerminalFieldType
{
    readonly name: TypeName;

    constructor(typeId: number, name: TypeName) {
        super(typeId);
        this.name = name;
        Object.freeze(this);
    }

    static make(name: TypeName): FieldTypeEnum {
        const key = FieldTypeEnum.typeKey(name);
        return FieldType.lookupOr(key, (id: number) => {
            return new FieldTypeEnum(id, name);
        });
    }

    enumName(): string {
        return this.name.name;
    }

    kind(): FieldTypeKind {
        return FieldTypeKind.Enum;
    }
    prettyString(): string {
        return `Enum<${this.enumName()}>`;
    }
    static typeKey(name: TypeName): string {
        return `array(${name.name})`;
    }

    matchesValue(schema: TreeSchema, value: Value)
      : boolean
    {
        const enm = schema.getDecl(this.name);
        assert(enm instanceof Enum);
        return enm.matchesValue(schema, value);
    }

    typescriptString(): string {
        return this.enumName();
    }
    reflectedString() {
        return `ReflectedSchema.${this.enumName()}`;
    }
}
