
import * as assert from 'assert';
import * as webidl2 from 'webidl2';

import {OrderedMap} from './ordered_map';
import {OrderedSet} from './ordered_set';


import {TreeSchema, Declaration,
        FieldType, TypeName,
        FieldTypePrimitive, FieldTypeNamed,
        FieldTypeUnion, FieldTypeArray, FieldTypeOpt,
        Typedef, Enum, Iface, IfaceField}
    from './tree_schema';

import {jsonStr} from './util';

/**
 * Top-level function to parse a webidl from a string
 * into a schema.
 */
export function liftWebidl(str: string,
                           symbolMap: (string) => string)
  : TreeSchema
{
    const json = webidl2.parse(str);
    assert(json instanceof Array);

    const lifter = new Lifter(symbolMap);
    json.forEach((decl: any, idx: number) => {
        lifter.addDecl(decl, idx);
    });

    const schema = lifter.makeSchema();
    console.log("Pre-flattened schema:");
    console.log(schema.prettyString());
    console.log("\n");

    /*
    const flatSchema = schema.flatten();
    console.log("Flattened schema:");
    console.log(flatSchema.prettyString());
    console.log("\n");
    */

    return schema;
}

class Lifter {
    // Array of accumulated declarations.
    readonly symbolMap: (string) => string;
    readonly decls: Array<Declaration>;

    constructor(symbolMap: (string) => string)
    {
        this.symbolMap = symbolMap;
        this.decls = new Array();
    }

    private mapSymbol(enumName: string, sym: string)
      : string
    {
        const name = this.symbolMap(sym);

        const RE = /^([A-Z][a-z0-9]*)+$/;
        assert(name.match(RE), `Bad symbol slug ${name}`);

        return name;
    }

    makeSchema(): TreeSchema {
        let decls = new OrderedMap<TypeName, Declaration>();
        for (let d of this.decls) {
            decls.set(d.name, d);
        }
        return new TreeSchema(decls);
    }

    addDecl(decl, idx: number) {
        if (decl.type === 'typedef') {
            // Add a typedef declaration.
            let td = this.liftTypedef(decl, idx);
            if (td !== 'ignore') {
                this.decls.push(td);
            }
        } else if (decl.type === 'enum') {
            // Add an enum declaration.
            this.decls.push(this.liftEnum(decl, idx));
        } else if (decl.type === 'interface') {
            // Add an interface declaration.
            let iface = this.liftIface(decl, idx);
            if (iface !== 'ignore') {
                this.decls.push(iface);
            }
        } else if (decl.type === 'eof') {
            // End.
            return;
        } else {
            const declStr = jsonStr(decl, 2);
            console.error("Unknown declaration idl:\n" +
                            declStr.replace(/^/g, '  '));
            throw new Error("Unknown declaration!");
        }
    }

    liftTypedef(typedefDecl, idx: number)
      : Typedef|'ignore'
    {
        assert(typeof(typedefDecl.idlType) === 'object',
               "Bad typedefDecl: " + jsonStr(typedefDecl));
        assert(typedefDecl.idlType.type === 'typedef-type');
        assert(typeof(typedefDecl.name) === 'string');

        const name: string = typedefDecl.name;
        const idlType = typedefDecl.idlType;

        // Ignore the typedef for 'string = DOMString'.
        // We just treat string as the terminal type.
        if (name === 'string') {
            assert(idlType.baseName === 'DOMString',
                   "Expected BinAST spec to specify " +
                   " `type string = DOMString`");
            return 'ignore';
        }

        const ft = this.liftIdlType(idlType);
        const typeName = TypeName.make(name);
        const td = new Typedef(typeName, ft);
        return td;
    }

    liftEnum(enumDecl, idx: number): Enum {
        assert(enumDecl.values instanceof Array);
        assert(typeof(enumDecl.name) === 'string');

        const name: string = enumDecl.name as string;
        const variants = new OrderedSet<string>();
        const values = new OrderedSet<string>();

        for (let enumVal of enumDecl.values) {
            assert(enumVal.type === 'string');
            assert(typeof(enumVal.value) === 'string');

            const value = enumVal.value;
            let variant = this.mapSymbol(name, value);
            variants.add(variant);
            values.add(value);
        }

        const typeName = TypeName.make(name);
        const e = new Enum(typeName, variants, values);
        return e;
    }

    liftIface(ifaceDecl, idx: number): Iface|'ignore' {
        assert(ifaceDecl.members instanceof Array);
        assert(typeof(ifaceDecl.name) === 'string');

        const name: string = ifaceDecl.name as string;
        if (name === 'Node') {
            // Skip the base Node interface.
            return 'ignore';
        }

        const members: OrderedMap<string, IfaceField>
            = new OrderedMap();

        for (let memberIdl of ifaceDecl.members) {
            assert(memberIdl.type === 'attribute');
            assert(typeof(memberIdl.name) === 'string');

            const memberName = memberIdl.name as string;
            const memberType = this.liftIdlType(
                                    memberIdl.idlType);
            // TODO: Check for extAttrs (lazy annotations).

            const field = new IfaceField(memberName,
                                         memberType);

            members.set(memberName, field);
        }

        let typeName = TypeName.make(name);
        const iface = new Iface(typeName, members);
        return iface;
    }

    liftIdlType(idlType): FieldType {
        // Try lifting an array type.
        const arrayFt = this.tryLiftArrayType(idlType);
        if (arrayFt !== null) {
            return arrayFt;
        }

        // Try lifting a union type.
        const unionFt = this.tryLiftUnionType(idlType);
        if (unionFt !== null) {
            return unionFt;
        }

        // Try lifting a simple type.
        const simpleFt = this.tryLiftSimpleType(idlType);
        if (simpleFt !== null) {
            return simpleFt;
        }

        throw new Error('Could not lift idlType: ' +
                        jsonStr(idlType));
    }

    tryLiftArrayType(idlType): FieldType|null {
        if (typeof(idlType.baseName) !== 'string') {
            return null;
        }

        if (idlType.baseName !== 'FrozenArray') {
            return null;
        }

        // Should not be a union.
        assert(idlType.union === false);

        assert(idlType.idlType instanceof Array);
        assert(idlType.idlType.length === 1);

        // Lift the inner type.
        const innerType = idlType.idlType[0];
        const innerFt = this.liftIdlType(innerType);

        let ft: FieldType = FieldTypeArray.make(innerFt);
        if (idlType.nullable) {
            ft = FieldTypeOpt.make(ft);
        }
        return ft;
    }

    tryLiftUnionType(idlType: any): FieldType|null {
        if (idlType.union !== true) {
            return null;
        }

        assert(idlType.baseName === null);
        assert(idlType.idlType instanceof Array);
        assert(idlType.idlType.length > 1);

        const variants = new Array<FieldType>();

        for (let variantIdl of idlType.idlType) {
            const vt = this.tryLiftSimpleType(variantIdl);
            if (vt === null) {
                throw new Error(
                    `Unrecognized union variant idl: ` +
                    JSON.stringify(variantIdl));
            }
            variants.push(vt);
        }

        let ft: FieldType = FieldTypeUnion.make(
                                Object.freeze(variants));
        if (idlType.nullable) {
            ft = FieldTypeOpt.make(ft);
        }
        return ft;
    }

    tryLiftSimpleType(idlType: any): FieldType|null
    {
        if (typeof(idlType.baseName) !== 'string') {
            return null;
        }

        // Skip unions.
        if (idlType.union !== false) {
            return null;
        }

        // Skip arrays.
        if (idlType.baseName === 'FrozenArray') {
            return null;
        }

        assert(idlType.baseName === idlType.idlType);

        switch (idlType.baseName) {
          case 'boolean':
            return FieldTypePrimitive.Bool;
          case 'double':
            return FieldTypePrimitive.F64;
          case 'string':
            return FieldTypePrimitive.Str;
        }

        // Interface names should be capitalized.
        const firstChar = idlType.baseName.charAt(0);
        assert(firstChar.toUpperCase() === firstChar,
               `Name ${idlType.baseName} not capitalized`);

        let tn = TypeName.make(idlType.baseName);
        let ft: FieldType = FieldTypeNamed.make(tn);
        if (idlType.nullable) {
            ft = FieldTypeOpt.make(ft);
        }
        return ft;
    }
}
