
import * as assert from 'assert';

import {TreeSchema, Typedef, Enum, Iface, Value, Instance}
    from './tree_schema';

import {FieldType, FieldTypePrimitive, FieldTypeIdent,
        FieldTypeOpt, FieldTypeNamed, FieldTypeUnion,
        FieldTypeArray}
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
export type PathShape =
    Iface | Enum | FieldTypePrimitive | FieldTypeIdent |
    FieldTypeOpt | FieldTypeArray;

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
        const idx = Math.max(this.path.length - 1, 0);
        return new PathIterator(this.path, idx);
    }
}

export class PathIterator {
    readonly path: Path;
    index: number;

    constructor(path: Path, index: number) {
        this.path = path;
        this.index = index;
    }

    next(): boolean {
        if (this.index === 0) {
            return false;
        }
        --this.index;
        return true;
    }

    get key(): PathKey {
        return this.path.keys[this.index];
    }
    get shape(): PathShape {
        return this.path.shapes[this.index];
    }
    get bound(): PathBound {
        return this.path.bounds[this.index];
    }
    get value(): Value {
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
    readonly handler: VisitHandler;
    readonly stack: Array<() => void>

    private constructor(
        schema: TreeSchema,
        root: Instance,
        handler: VisitHandler)
    {
        this.schema = schema;
        this.cursor = new TreeCursor(new Path());
        this.root = root;
        this.handler = handler;
        this.stack = new Array();
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
    private makeRootShape(): Iface {
        // Just the root instance iface.
        return this.root.iface$;
    }
    private makeRootBound(): FieldType {
        // Just a FieldType containing the type of
        // the root node for now.
        return this.root.iface$.intoFieldType();
    }

    visit() {
        this.visitItem(this.makeRootKey(),
                       this.makeRootShape(),
                       this.makeRootBound(),
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

        if (shape instanceof Iface) {
            this.walkIface(shape);
        } else if (shape instanceof Enum) {
            this.walkEnum(shape);
        } else if (shape instanceof FieldTypePrimitive) {
            this.walkPrimitive(shape);
        } else if (shape instanceof FieldTypeIdent) {
            this.walkIdent(shape);
        } else if (shape instanceof FieldTypeOpt) {
            this.walkOpt(shape);
        } else if (shape instanceof FieldTypeArray) {
            this.walkArray(shape);
        } else {
            throw new Error(`Unknown shape: ${shape}`);
        }

        assert(this.cursor.value === value);

        // End this tree item.
        this.handler.end(this.schema, this.cursor);

        this.cursor.pop(value);
    }

    private walkIface(iface: Iface) {
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

    private walkEnum(enm: Enum) {
        const value = this.cursor.value;
        assert(enm.matchesValue(this.schema, value));
    }

    private walkPrimitive(ty: FieldTypePrimitive) {
        const value = this.cursor.value;
        assert(ty.matchesValue(this.schema, value));
    }

    private walkIdent(ty: FieldTypeIdent) {
        const value = this.cursor.value;
        assert(ty.matchesValue(this.schema, value));
    }

    private walkOpt(ty: FieldTypeOpt) {
        // The only value with an Opt shape is
        // null.  Any other value will have some
        // inner type as the shape.
        const value = this.cursor.value;
        assert(ty.matchesValue(this.schema, value));
    }

    private walkArray(ty: FieldTypeArray) {
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

    private resolveShape(ty: FieldType, value: Value)
      : PathShape
    {
        const rty = ty.resolveType(this.schema, value);
        assert(rty !== null,
            `Bad rty: ${rty} for: ${jsonStr(value)}\n` +
            `ty=${ty.prettyString()}`);

        // Check the type, resolve named types to
        // Iface or Enum.
        if (rty instanceof FieldTypeNamed) {
            const decl = this.schema.getDecl(rty.name);
            assert((decl instanceof Iface) ||
                   (decl instanceof Enum));
            return decl as (Iface|Enum);
        }

        // Otherwise, it should be one of the
        // allowed field types - not a union.
        assert((rty instanceof FieldTypePrimitive) ||
               (rty instanceof FieldTypeIdent) ||
               (rty instanceof FieldTypeArray) ||
               (rty instanceof FieldTypeOpt));

        return rty as PathShape;
    }
}
