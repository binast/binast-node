
import * as assert from 'assert';
import * as webidl2 from 'webidl2';

import {OrderedMap} from './ordered_map';

import {TreeSchema, Declaration, TypeName, EnumVariantName,
        Typedef, Enum, Iface, IfaceField}
    from './tree_schema';
import {FieldType, FieldTypePrimitive, FieldTypeNamed,
        FieldTypeUnion, FieldTypeArray, FieldTypeOpt}
    from './field_types';

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
    return schema;
}

class Lifter {
    // Array of accumulated declarations.
    readonly symbolMap: (string) => string;
    readonly variantCache: Map<string, EnumVariantName>;
    readonly decls: Array<Declaration>;

    constructor(symbolMap: (string) => string)
    {
        this.symbolMap = symbolMap;
        this.variantCache = new Map();
        this.decls = new Array();
    }

    private mapEnumVariant(enumName: TypeName, str: string)
      : EnumVariantName
    {
        const valName = this.symbolMap(str);
        const RE = /^([A-Z][a-z0-9]*)+$/;
        assert(valName.match(RE),
               `Bad symbol slug ${valName}`);

        const key = EnumVariantName.makeKey(enumName.name,
                                            valName);
        let evn = this.variantCache.get(key);
        if (!evn) {
            evn = EnumVariantName.make(enumName, valName);
            this.variantCache.set(key, evn);
        }
        return evn;
    }

    makeSchema(): TreeSchema {
        return new TreeSchema(this.decls.slice());
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
        const variants = new Array<EnumVariantName>();
        const values = new Array<string>();

        const enumName = TypeName.make(name);

        for (let enumVal of enumDecl.values) {
            assert(enumVal.type === 'string');
            assert(typeof(enumVal.value) === 'string');

            const value = enumVal.value;
            let variant = this.mapEnumVariant(enumName,
                                              value);
            variants.push(variant);
            values.push(value);
        }

        const e = new Enum(enumName, variants, values);
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

        const members = new Array<IfaceField>();

        for (let memberIdl of ifaceDecl.members) {
            assert(memberIdl.type === 'attribute');
            assert(typeof(memberIdl.name) === 'string');

            const memberName = memberIdl.name as string;
            const memberType = this.liftIdlType(
                                    memberIdl.idlType);
            // TODO: Check for extAttrs (lazy annotations).

            const field = new IfaceField(memberName,
                                         memberType);

            members.push(field);
        }

        const isNode = (ifaceDecl.inheritance !== null) &&
                   (ifaceDecl.inheritance.name == 'Node');

        let typeName = TypeName.make(name);
        const iface = new Iface(typeName, members, isNode);
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
