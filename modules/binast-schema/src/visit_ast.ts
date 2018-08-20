
import * as assert from 'assert';

import {TreeSchema, Typedef, Enum, Iface, Value, Instance}
    from './tree_schema';

import {FieldType, TerminalFieldType,
        FieldTypePrimitive, FieldTypeIdent,
        FieldTypeNamed, FieldTypeUnion, FieldTypeArray,
        FieldTypeIface, FieldTypeEnum,
        TypeSet, ResolvedType}
    from './field_types';

import {jsonStr} from './util';

/*
 * Conceptually, the visitor emits a stream of
 * syntax atoms, with some understanding of a tree
 * extracted from subsequences of those symbols.
 *
 * The visitation we are generally concerned with
 * here is depth-first.  The visitor calls into a
 * callback interface, discriminating between:
 *
 *  - AST Nodes.
 *  - Enum strings.
 *  - Non-Node structures (e.g. asserted scopes).
 *  - Free-typed structures:
 *    * Arrays.
 *    * Primitive values.
 *
 * The callback calls pass along the following information:
 *
 *  - The schema containing the element.
 *  - The path of the element being visited.
 *  - A FieldType of the type bounds of the value.
 *  - The value itself.
 */

// Key describes the literal edge label (strings for
// interfaces, indexes for arrays) that leads to a
// given encoded symbol.
export type PathKey = string | number;

// Shape describes the represenation of the value
// being encoded - a specific Iface, Enum, Array,
// or primitive type.
export type PathShape = ResolvedType;

// Bound describes the bounds on this type, which is
// the set of allowable types at this location,
// according to the schema.
export type PathBound = FieldType;

export class Path {
    /* `keys` is a sequence with the list pattern:
     *      `(Iface, string, (string|number)*)*`
     *
     * In english the keys sequence can be:
     *  * Empty (for the root)
     *  * A single iface entry.
     *  * An iface followed by a name.
     *  * An iface, name, and a list of `(name|index)`.
     */
    readonly keys: Array<PathKey>;
    readonly shapes: Array<PathShape>;
    readonly bounds: Array<PathBound>;
    readonly values: Array<Value>;

    constructor() {
        this.keys = new Array();
        this.shapes = new Array();
        this.bounds = new Array();
        this.values = new Array();
    }

    get length(): number {
        return this.values.length;
    }

    push(key: PathKey,
         shape: PathShape,
         bound: PathBound,
         value: Value)
    {
        this.keys.push(key);
        this.shapes.push(shape);
        this.bounds.push(bound);
        this.values.push(value);
    }

    pop(value: Value) {
        assert(this.length > 0);
        this.keys.pop();
        this.shapes.pop();
        this.bounds.pop();
        const popVal = this.values.pop();
        assert(popVal === value);
    }
}

export interface TreeLocation {
    getKey(index: number): PathKey;
    getShape(index: number): PathShape;
    getBound(index: number): PathBound;
    getValue(index: number): Value;

    key: PathKey;
    shape: PathShape;
    bound: PathBound;
    value: Value;

    ancestors(): PathIterator;
}

class TreeCursor implements TreeLocation {
    readonly path: Path;

    constructor(path: Path) {
        this.path = path;
    }

    push(key: PathKey,
         shape: PathShape,
         bound: PathBound,
         value: Value)
    {
        this.path.push(key, shape, bound, value);
    }

    pop(value: Value) {
        this.path.pop(value);
    }

    getKey(index: number): PathKey {
        assert(index >= 0 && index < this.path.length);
        return this.path.keys[index];
    }
    getShape(index: number): PathShape {
        assert(index >= 0 && index < this.path.length);
        return this.path.shapes[index];
    }
    getBound(index: number): PathBound {
        assert(index >= 0 && index < this.path.length);
        return this.path.bounds[index];
    }
    getValue(index: number): Value {
        assert(index >= 0 && index < this.path.length);
        return this.path.values[index];
    }

    get key(): PathKey {
        return this.getKey(this.path.length - 1);
    }
    get shape(): PathShape {
        return this.getShape(this.path.length - 1);
    }
    get bound(): PathBound {
        return this.getBound(this.path.length - 1);
    }
    get value(): Value {
        return this.getValue(this.path.length - 1);
    }

    ancestors(): PathIterator {
        return new PathIterator(this.path);
    }
}

export class PathIterator {
    readonly path: Path;
    index: number;

    constructor(path: Path) {
        this.path = path;
        this.index = path.length - 1;
    }

    get done(): boolean {
        return this.index < 0;
    }

    next() {
        assert( ! this.done);
        --this.index;
    }

    get key(): PathKey {
        assert( ! this.done);
        return this.path.keys[this.index];
    }
    get shape(): PathShape {
        assert( ! this.done);
        return this.path.shapes[this.index];
    }
    get bound(): PathBound {
        assert( ! this.done);
        return this.path.bounds[this.index];
    }
    get value(): Value {
        assert( ! this.done);
        return this.path.values[this.index];
    }
}

export interface VisitHandler {
    begin(schema: TreeSchema, loc: TreeLocation);
    end(schema: TreeSchema, loc: TreeLocation);
}

export class Visitor {
    readonly schema: TreeSchema;
    readonly cursor: TreeCursor;
    readonly root: Instance;
    readonly rootTy: FieldTypeIface;
    readonly handler: VisitHandler;
    readonly stack: Array<() => void>;
    readonly cachedTypeSets: Map<FieldType, TypeSet>;

    private constructor(
        schema: TreeSchema,
        root: Instance,
        handler: VisitHandler)
    {
        this.schema = schema;
        this.cursor = new TreeCursor(new Path());
        this.root = root;
        this.rootTy =
            FieldTypeIface.make(this.root.iface$.name);
        this.handler = handler;
        this.stack = new Array();
        this.cachedTypeSets = new Map();
    }

    static make(params: {schema: TreeSchema,
                         root: Instance,
                         handler: VisitHandler})
      : Visitor
    {
        const {schema, root, handler} = params;
        return new Visitor(schema, root, handler);
    }

    private makeRootKey(): string {
        return '$Root'
    }
    private makeRootShape(): PathShape {
        // Just the root instance iface.
        return this.resolveShape(this.rootTy, this.root);
    }
    private makeRootBound(): FieldType {
        // Just a FieldType containing the type of
        // the root node for now.
        return this.root.iface$.intoFieldType();
    }

    visit() {
        const rootKey = '$Root';
        const rootShape = this.resolveShape(this.rootTy,
                                            this.root);
        const rootBound = this.root.iface$.intoFieldType();
        
        this.visitItem(rootKey, rootShape, rootBound,
                       this.root);
    }

    private visitItem(key: PathKey,
                      shape: PathShape,
                      bound: PathBound,
                      value: Value)
    {
        // Push the item on the stack.
        this.cursor.push(key, shape, bound, value);

        // Begin this tree item.
        this.handler.begin(this.schema, this.cursor);

        assert(shape instanceof ResolvedType);

        if (shape.ty instanceof FieldTypeIface) {
            this.walkIface(shape, shape.ty);
        } else if (shape.ty instanceof FieldTypeEnum) {
            this.walkEnum(shape, shape.ty);
        } else if (shape.ty instanceof FieldTypePrimitive) {
            this.walkPrimitive(shape, shape.ty);
        } else if (shape.ty instanceof FieldTypeIdent) {
            this.walkIdent(shape, shape.ty);
        } else if (shape.ty instanceof FieldTypeArray) {
            this.walkArray(shape, shape.ty);
        } else {
            throw new Error(`Unknown shape: ${shape}`);
        }

        assert(this.cursor.value === value);

        // End this tree item.
        this.handler.end(this.schema, this.cursor);

        this.cursor.pop(value);
    }

    private walkIface(shape: PathShape,
                      iface: FieldTypeIface)
    {
        const schema = this.schema;
        const value = this.cursor.value;
        assert(iface.matchesValue(schema, value));
        const inst = value as Instance;

        for (let field of inst.iface$.fields) {
            const ty = field.ty;
            const value = inst[field.name];
            // const bound = ty.flatten(this.schema);
            const bound = ty;
            const shape = this.resolveShape(ty, value);
            const key = field.name;

            assert(shape !== null);

            this.visitItem(key, shape, bound, value);
        }
    }

    private walkEnum(shape: PathShape,
                     enm: FieldTypeEnum)
    {
        const value = this.cursor.value;
        assert(enm.matchesValue(this.schema, value));
    }

    private walkPrimitive(shape: PathShape,
                          ty: FieldTypePrimitive)
    {
        const value = this.cursor.value;
        assert(ty.matchesValue(this.schema, value));
    }

    private walkIdent(shape: PathShape,
                      ty: FieldTypeIdent)
    {
        const value = this.cursor.value;
        assert(ty.matchesValue(this.schema, value));
    }

    private walkArray(shape: PathShape,
                      ty: FieldTypeArray)
    {
        const schema = this.schema;
        assert(ty.matchesValue(schema, this.cursor.value));

        const arr = this.cursor.value as Array<Value>;
        arr.forEach((value: Value, i: number) => {
            const vty = ty.inner;
            // const bound = vty.flatten(this.schema);
            const bound = vty;
            const shape = this.resolveShape(vty, value);
            const key = i;

            assert(shape !== null);

            this.visitItem(key, shape, bound, value);
        });
    }

    private getTypeSetFor(ty: FieldType): TypeSet {
        if (!this.cachedTypeSets.has(ty)) {
            const tySet = ty.flatten(this.schema);
            this.cachedTypeSets.set(ty, tySet);
        }
        return this.cachedTypeSets.get(ty);
    }

    private resolveShape(ty: FieldType, value: Value)
      : ResolvedType
    {
        const tySet = this.getTypeSetFor(ty);
        const rty = tySet.resolveType(this.schema, value);
        assert(rty !== null,
            `Bad resolve for: ${jsonStr(value)}\n` +
            `ty=${ty.prettyString()}`);

        return rty;
    }
}
