
import * as assert from 'assert';

export function jsonStr(val: any, tab?: number): string {
    return JSON.stringify(val, null, tab||2);
}

export function shiftString(str: string,
                            shift: number)
  : string
{
    const shiftStr = ' '.repeat(shift);
    return shiftStr + str.replace(/\n/g, '\n' + shiftStr);
}

export function hasOwnProp(obj: object, name: string)
  : boolean
{
    return Object.prototype.hasOwnProperty.call(obj, name);
}

export function symbolToName(sym: string): string {
    switch (sym) {
      // VariableDeclarationKind
      case "var": return "KwVar";
      case "let": return "KwLet";
      case "const": return "KwConst";

      // CompoundAssignmentOperator
      case "+=": return "PlusAssign";
      case "-=": return "MinusAssign";
      case "*=": return "MulAssign";
      case "/=": return "DivAssign";
      case "%=": return "ModAssign";
      case "**=": return "PowAssign";
      case "<<=": return "LshAssign";
      case ">>=": return "RshAssign";
      case ">>>=": return "ArshAssign";
      case "|=": return "BitorAssign";
      case "^=": return "BitxorAssign";
      case "&=": return "BitandAssign";

      // BinaryOperator
      case ",": return "Comma";
      case "||": return "LogicalOr";
      case "&&": return "LogicalAnd";
      case "|": return "Bitor";
      case "^": return "Bitxor";
      case "&": return "Bitand";
      case "==": return "Equal";
      case "!=": return "NotEqual";
      case "===": return "StrictEqual";
      case "!==": return "NotStrictEqual";
      case "<": return "LessThan";
      case "<=": return "LessEqual";
      case ">": return "GreaterThan";
      case ">=": return "GreaterEqual";
      case "in": return "KwIn";
      case "instanceof": return "KwInstanceof";
      case "<<": return "Lsh";
      case ">>": return "Rsh";
      case ">>>": return "Arsh";
      case "+": return "Plus";
      case "-": return "Minus";
      case "*": return "Mul";
      case "/": return "Div";
      case "%": return "Mod";
      case "**": return "Pow";

      // UnaryOperator
      // case "+": return "Plus";
      // case "-": return "Minus";
      case "!": return "LogicalNot";
      case "~": return "Bitnot";
      case "typeof": return "KwTypeof";
      case "void": return "KwVoid";
      case "delete": return "KwDelete";

      // UpdateOperator
      case "++": return "PlusPlus";
      case "--": return "MinusMinus";

      // AssertedDeclaredKind
      // case "var": return "KwVar";
      case "non-const lexical": return "NonConstLexical";
      case "const lexical": return "ConstLexical";
    }

    throw new Error(`Unrecognized symbol: ${sym}`);
}
