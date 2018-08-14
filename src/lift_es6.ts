
"use strict";

import * as assert from 'assert';
import * as S from './typed_schema';

class MatchError extends Error {
    readonly matchType: string;
    readonly unrecognizedValue: any;

    constructor(matchType, unrecognizedValue) {
        super(`MatchError(${matchType}) -` +
              ` ${unrecognizedValue}`);
        this.matchType = matchType;
        this.unrecognizedValue = unrecognizedValue;
    }
}

function assertNodeType(node: any, typeStr: string) {
    assert.equal(node.type, typeStr,
                 `Node type ${node.type} != ${typeStr}`);
}
function assertType(val: any,
                    typeStr: string,
                    nullable: boolean = false)
{
    const chkStr: string = nullable ? `${typeStr}???`
                                    : typeStr;
    if (nullable && val === null) { return; }
    assert.equal(typeof(val), typeStr,
                 `Type ${typeof val} != ${chkStr}`);
}
function assertIsArray(val: any) {
    return Array.isArray(val);
}
function propNames(obj: any) {
    return Object.getOwnPropertyNames(obj);
}
function summarizeNode(obj: any): any {
    const result = {};
    for (let name in obj) {
        const n = (name === 'type') ? '<<<TYPE>>>' : name;
        if (Array.isArray(obj[name])) {
            result[n] = '<<<ARRAY>>>';
        } else if ((typeof(obj[name]) === 'object') &&
                   (obj[name] !== null))
        {
            if ('type' in obj[name]) {
                result[n] = `<<<TYPE:${obj[name].type}>>>`;
            } else {
                result[n] = '<<<OBJECT>>>';
            }
        } else {
            result[n] = obj[name];
        }
    }
    return result;
}
function nodeShortSummary(obj: any): string {
    return `${obj.type}(${propNames(obj)})`;
}

type AssertedName = S.AssertedDeclaredName |
                    S.AssertedBoundName;
abstract class BaseScope {
    names: Array<AssertedName>;
    hasDirectEval: boolean;

    // Maps identifier names to the index into
    // an appropriate array.
    nameMap: Map<S.IdentifierName, number>;
    captureSet: Set<S.IdentifierName>;

    constructor() {
        this.names = new Array();
        this.hasDirectEval = false;

        this.nameMap = new Map();
        this.captureSet = new Set();
    }

    addName(nameEntry: AssertedName) {
        const name = nameEntry.name;
        assert(typeof(name) == 'string')
        assert(!this.nameMap.has(name));
        const idx = this.names.length;
        this.names.push(nameEntry);
        this.nameMap.set(name, idx);
    }

    doesBindName(name: S.IdentifierName): boolean {
        return this.nameMap.get(name) !== undefined;
    }

    /** Try to capture the use of the given name with this
     * scope.  Return whether successful. */
    findOrCaptureUse(name: S.IdentifierName,
                     capture: boolean)
      : boolean
    {
        if (this.doesBindName(name)) {
            if (capture && !this.captureSet.has(name)) {
                this.captureSet.add(name);
                this.markCaptured(name);
            }
            return true;
        }
        return false;
    }

    protected abstract markCaptured(name: S.IdentifierName);
}

abstract class DeclaredScope extends BaseScope {
    protected markCaptured(name: S.IdentifierName) {
        const idx = this.nameMap.get(name);
        assert(this.names[idx] instanceof
                    S.AssertedDeclaredName);
        const declName = this.names[idx] as
                            S.AssertedDeclaredName;
        const newDeclName = S.AssertedDeclaredName.make({
            name: name,
            kind: declName.kind,
            isCaptured: true
        });
        this.names[idx] = newDeclName;
    }

    protected declNames(): Array<S.AssertedDeclaredName> {
        assert(this.names.every(n => {
            return n instanceof S.AssertedDeclaredName;
        }));
        return this.names as Array<S.AssertedDeclaredName>;
    }
}

abstract class BoundScope extends BaseScope {
    protected markCaptured(name: S.IdentifierName) {
        const idx = this.nameMap.get(name);
        assert(this.names[idx] instanceof
                    S.AssertedBoundName);
        const boundName = this.names[idx] as
                                S.AssertedBoundName;
        const newBoundName = S.AssertedBoundName.make({
            name: name,
            isCaptured: true
        });
        this.names[idx] = newBoundName;
    }

    protected boundNames(): Array<S.AssertedBoundName> {
        assert(this.names.every(n => {
            return n instanceof S.AssertedBoundName;
        }));
        return this.names as Array<S.AssertedBoundName>;
    }
}

class BlockScope extends DeclaredScope {
    constructor() {
        super();
    }

    extractBlockScope(): S.AssertedBlockScope {
        return S.AssertedBlockScope.make({
            declaredNames: Object.freeze(this.declNames()),
            hasDirectEval: this.hasDirectEval
        });
    }
}

class ScriptGlobalScope extends DeclaredScope {
    constructor() {
        super();
    }

    extractBlockScope(): S.AssertedScriptGlobalScope {
        const declNames = Object.freeze(this.names);
        return S.AssertedScriptGlobalScope.make({
            declaredNames: Object.freeze(this.declNames()),
            hasDirectEval: this.hasDirectEval
        });
    }
}

class VarScope extends DeclaredScope {
    constructor() {
        super();
    }

    extractVarScope(): S.AssertedVarScope {
        return S.AssertedVarScope.make({
            declaredNames: Object.freeze(this.declNames()),
            hasDirectEval: this.hasDirectEval
        });
    }
}

class ParameterScope extends BoundScope {
    isSimpleParameterList: boolean;

    constructor() {
        super();
        this.isSimpleParameterList = false;
    }

    extractParameterScope(): S.AssertedParameterScope {
        return S.AssertedParameterScope.make({
            boundNames: Object.freeze(this.boundNames()),
            hasDirectEval: this.hasDirectEval,
            isSimpleParameterList:
                this.isSimpleParameterList
        });
    }
}

class BoundNamesScope extends BoundScope {
    constructor() {
        super();
    }

    extractBoundNamesScope(): S.AssertedBoundNamesScope {
        return S.AssertedBoundNamesScope.make({
            boundNames: Object.freeze(this.boundNames()),
            hasDirectEval: this.hasDirectEval
        });
    }
}

enum ScopeBindMode {
    None = "none",
    Var = "var",
    Let = "let",
    Const = "const",
    Parameter = "parameter"
}

class Context {
    scopeStack: Array<BaseScope>;
    bindStack: Array<ScopeBindMode>;

    constructor() {
        this.scopeStack = new Array();
        this.bindStack = new Array();
    }

    atTopScope(): boolean {
        return this.scopeStack.length === 0;
    }

    enterBlockScope<T>(f: (BlockScope) => T): T {
        return this.enterScope<BlockScope, T>(
            new BlockScope(), f);
    }
    enterScriptGlobalScope<T>(
        f: (ScriptGlobalScope) => T)
      : T
    {
        return this.enterScope<ScriptGlobalScope, T>(
            new ScriptGlobalScope(), f);
    }
    enterVarScope<T>(f: (VarScope) => T): T {
        return this.enterScope<VarScope, T>(
            new VarScope(), f);
    }
    enterParameterScope<T>(f: (ParameterScope) => T): T {
        return this.enterScope<ParameterScope, T>(
            new ParameterScope(), f);
    }
    enterBoundNamesScope<T>(f: (BoundNamesScope) => T): T {
        return this.enterScope<BoundNamesScope, T>(
            new BoundNamesScope(), f);
    }
    private enterScope<S extends BaseScope, T>(
        scope: S,
        f: (S) => T
    ): T
    {
        this.scopeStack.push(scope);
        const result = f(scope);
        this.scopeStack.pop();
        return result;
    }

    bindDeclKind<T>(kind: S.VariableDeclarationKind,
                    f: () => T)
      : T
    {
        switch (kind) {
          case S.VariableDeclarationKind.KwVar:
            return this.bindVars(f);
          case S.VariableDeclarationKind.KwLet:
            return this.bindLets(f);
          case S.VariableDeclarationKind.KwConst:
            return this.bindConsts(f);
          default:
            throw new Error(
                `Invalid VariableDeclarationKind ${kind}`);
        }
    }
    bindVars<T>(f: () => T): T {
        return this.bind<T>(ScopeBindMode.Var, f);
    }
    bindLets<T>(f: () => T): T {
        return this.bind<T>(ScopeBindMode.Let, f);
    }
    bindConsts<T>(f: () => T): T {
        return this.bind<T>(ScopeBindMode.Const, f);
    }
    bindParameters<T>(f: () => T): T {
        return this.bind<T>(ScopeBindMode.Parameter, f);
    }
    private bind<T>(mode: ScopeBindMode, f: () => T): T {
        this.bindStack.push(mode);
        const result = f();
        this.bindStack.pop();
        return result;
    }

    noteBoundName(name: S.Identifier) {
        assert(this.bindStack.length > 0);
        const bindMode = this.bindStack[
                            this.bindStack.length - 1];
        switch (bindMode) {
          case ScopeBindMode.Var:
            return this.noteDeclaredVar(name);

          case ScopeBindMode.Let:
            return this.noteDeclaredLet(name);

          case ScopeBindMode.Const:
            return this.noteDeclaredConst(name);

          case ScopeBindMode.Parameter:
            return this.noteBoundParameter(name);

          default:
            throw new Error(`Invalid scope bind mode:` +
                            ` ${bindMode}`);
        }
    }

    private idToIdName(id: S.Identifier)
      : S.IdentifierName
    {
        // ASSERT: S.ReflectedSchema.typeof_Identifier
        //      == S.ReflectedSchema.typeof_IdentifierName.
        //      == S.ReflectedSchema.TStr
        return id as S.IdentifierName;
    }

    private noteDeclared(name: S.Identifier,
                         kind: S.AssertedDeclaredKind,
                         classes: Array<Function>)
    {
        const found = this.eachScope(scope => {
            if (!(scope instanceof DeclaredScope)) {
                // Continue to next scope.
                return;
            }
            assert(classes.some(c => scope instanceof c));

            const declScope = scope as DeclaredScope;
            const dn = S.AssertedDeclaredName.make({
                name: this.idToIdName(name),
                kind: kind,
                isCaptured: false
            });
            declScope.addName(dn);
            return true;
        });
        assert(found === true);
    }

    private noteBound(name: S.Identifier) {
        const found = this.eachScope(scope => {
            if (! (scope instanceof BoundScope)) {
                // Continue to next scope.
                return;
            }

            const boundScope = scope as BoundScope;
            const bn = S.AssertedBoundName.make({
                name: this.idToIdName(name),
                isCaptured: false
            });
            boundScope.addName(bn);
            return true;
        });
        assert(found === true);
    }

    private noteDeclaredVar(name: S.Identifier) {
        this.noteDeclared(name,
            S.AssertedDeclaredKind.KwVar,
            [VarScope]);
    }

    private noteDeclaredLet(name: S.Identifier) {
        this.noteDeclared(name,
            S.AssertedDeclaredKind.NonConstLexical,
            [VarScope, BlockScope, ScriptGlobalScope]);
    }

    private noteDeclaredConst(name: S.Identifier) {
        this.noteDeclared(name,
            S.AssertedDeclaredKind.ConstLexical,
            [VarScope, BlockScope, ScriptGlobalScope]);
    }

    private noteBoundParameter(name: S.Identifier) {
        this.noteBound(name);
    }

    private eachScope<T>(f: (BaseScope) => T|undefined)
      : T|undefined
    {
        const len = this.scopeStack.length;
        for (var i = 0; i < len; i++) {
            const scope = this.scopeStack[len - (i+1)];
            const r = f(scope);
            if (r !== undefined) {
                return r;
            }
        }
        return undefined;
    }

    /* Note the use of a name in the current scope context.
     * Return the scope that binds the name (after marking
     * it at used if necessary), or return null if the
     * reference is free.
     */
    noteUseName(name: string): BaseScope|null {
        let capture: boolean = false;

        const foundScope = this.eachScope(
          (scope: BaseScope) => {
            if (scope.findOrCaptureUse(name, capture)) {
                return scope;
            }

            // When crossing a VarScope boundary, start
            // capturing names as we're entering a caller
            // function's scope.
            if (!capture && (scope instanceof VarScope)) {
                capture = true;
            }

            // Continue to next scope.
            return;
          });
        return foundScope || null;
    }
}

export class Registry<T> {
    // Table mapping all grammar nodes that are used to
    // number of uses.
    freqMap: Map<T, number>;

    constructor() {
        this.freqMap = new Map();
    }

    note(v: T) {
        const count = this.freqMap.get(v);
        const next = (count !== undefined)
                        ? (count as number) + 1
                        : 1;
        this.freqMap.set(v, next);
    }

    // Return an array of all the nodes ordered by use.
    inFrequencyOrder(): Array<T> {
        const vt = this.freqMap;
        const array: Array<T> = new Array();
        for (let v of vt.keys()) {
            array.push(v);
        }
        // Sort, with highest frequencies showing up first.
        array.sort((a: T, b: T) => (vt.get(b) - vt.get(a)));

        return array;
    }

    frequencyOf(v: T) {
        assert(this.freqMap.has(v));
        return this.freqMap.get(v);
    }
}

export class Importer {
    readonly cx: Context;
    readonly strings: Registry<string>;
    readonly nodes: Registry<object>;

    constructor() {
        this.cx = new Context();
        this.strings = new Registry<string>();
    }

    //
    // Top level
    //

    liftScript(json: any): S.Script {
        assertNodeType(json, 'Script');
        assert(this.cx.atTopScope());

        const directives =
            (json.directives as Array<any>).map(
                d => this.liftDirective(d));

        return this.cx.enterVarScope((ss: VarScope) => {
            const statements =
                (json.statements as Array<any>).map(
                    s => this.liftStatement(s));

            const scope = ss.extractVarScope();

            return S.Script.make({scope, directives,
                                  statements});
        });
    }

    liftDirective(json: any): S.Directive {
        assertNodeType(json, 'Directive');
        assertType(json.rawValue, 'string');

        const rawValue = json.rawValue as string;
        this.strings.note(rawValue);

        return S.Directive.make({rawValue});
    }

    //
    // Statements
    //

    liftStatement(json: any): S.Statement {
        switch (json.type as string) {
          case 'ExpressionStatement':
            return this.liftExpressionStatement(json);
          case 'VariableDeclarationStatement':
            return this.liftVariableDeclarationStatement(
                                                    json);
          case 'FunctionDeclaration':
            return this.liftFunctionDeclaration(json);
          case 'IfStatement':
            return this.liftIfStatement(json);
          case 'WhileStatement':
            return this.liftWhileStatement(json);
          case 'DoWhileStatement':
            return this.liftDoWhileStatement(json);
          case 'BlockStatement':
            return this.liftBlockStatement(json);
          case 'ReturnStatement':
            return this.liftReturnStatement(json);
          case 'ForInStatement':
            return this.liftForInStatement(json);
          case 'ForStatement':
            return this.liftForStatement(json);
          case 'BreakStatement':
            return this.liftBreakStatement(json);
          case 'ContinueStatement':
            return this.liftContinueStatement(json);
          case 'TryCatchStatement':
            return this.liftTryCatchStatement(json);
          case 'TryFinallyStatement':
            return this.liftTryFinallyStatement(json);
          case 'ThrowStatement':
            return this.liftThrowStatement(json);
          case 'SwitchStatement':
            return this.liftSwitchStatement(json);
          case 'SwitchStatementWithDefault':
            return this.liftSwitchStatementWithDefault(
                                                    json);
          case 'LabeledStatement': /* WHAT? */
            return this.liftLabeledStatement(json);
          case 'EmptyStatement':
            return this.liftEmptyStatement(json);
          default:
            throw new MatchError('Statement', json.type);
        }
    }

    liftExpressionStatement(json: any)
      : S.ExpressionStatement
    {
        assertNodeType(json, 'ExpressionStatement');

        const expression = this.liftExpression(
                                    json.expression);
        return S.ExpressionStatement.make({expression});
    }

    liftVariableDeclarationStatement(json: any)
      : S.VariableDeclaration
    {
        assertNodeType(json,
                'VariableDeclarationStatement');
        return this.liftVariableDeclaration(
                                json.declaration);
    }

    liftVariableDeclaration(json: any)
      : S.VariableDeclaration
    {
        assertNodeType(json, 'VariableDeclaration');

        const kind = this.liftVariableDeclarationKind(
                                    json.kind as string);
        const declarators = json.declarators.map(d => {
            return this.liftVariableDeclarator(d)
        });

        return S.VariableDeclaration.make({kind,
                                        declarators});
    }
    liftVariableDeclarationKind(kind: string)
      : S.VariableDeclarationKind
    {
        this.strings.note(kind);
        switch (kind) {
          case 'var':
            return S.VariableDeclarationKind.KwVar;
          case 'let':
            return S.VariableDeclarationKind.KwLet;
          case 'const':
            return S.VariableDeclarationKind.KwConst;
          default:
            throw new MatchError(
                'VariableDeclarationKind', kind);
        }
    }
    liftVariableDeclarator(json: any)
      : S.VariableDeclarator
    {
        assertNodeType(json, 'VariableDeclarator');

        // Lift the expression before the binding because
        // the expression does not capture the bound
        // variable name.
        const init = (('init' in json) &&
                      (json.init !== null))
                            ? this.liftExpression(json.init)
                            : null;
        const binding = this.cx.bindVars(() => {
            return this.liftBinding(json.binding);
        });
        return S.VariableDeclarator.make({binding, init});
    }
    liftBinding(json: any): S.Binding {
        const binding = this.tryLiftBinding(json);
        if (binding === null) {
            throw new MatchError('Binding', json.type);
        }
        return binding;
    }
    tryLiftBinding(json: any): S.Binding|null {
        switch (json.type) {
          case 'BindingIdentifier':
            return this.liftBindingIdentifier(json);
          case 'BindingPattern':
            throw new Error(
                'BindingPattern not handled yet.');
          default:
            return null;
        }
    }
    liftBindingIdentifier(json: any): S.BindingIdentifier {
        assertNodeType(json, 'BindingIdentifier');
        assertType(json.name, 'string');

        const name = this.liftIdentifier(json.name);
        this.cx.noteBoundName(name);
        return S.BindingIdentifier.make({name});
    }

    liftIdentifier(name: string): S.Identifier {
        this.strings.note(name);
        return name as S.Identifier;
    }

    liftFunctionDeclaration(json: any)
      : S.FunctionDeclaration
    {
        assertNodeType(json, 'FunctionDeclaration');
        assertType(json.isGenerator, 'boolean');
        assertNodeType(json.body, 'FunctionBody');
        assertIsArray(json.body.directives);

        const directives = json.body.directives.map(
                            d => this.liftDirective(d));

        // TODO: Handle isAsync and isThisCaptured !!
        const isAsync = false;
        const isGenerator = json.isGenerator as boolean;
        const isThisCaptured = false;
        return this.cx.enterParameterScope(ps => {

            const name = this.cx.bindParameters(() => {
                return this.liftBindingIdentifier(
                                            json.name);
            });

            const params =
                this.liftFormalParameters(json.params);

            const parameterScope =
                    ps.extractParameterScope();

            return this.cx.enterVarScope(bs => {

                // ASSERT: FunctionBody is Array<Statement>
                const body =
                    json.body.statements.map(
                        s => this.liftStatement(s));

                const bodyScope = bs.extractVarScope();

                const contents =
                    S.FunctionOrMethodContents.make({
                        isThisCaptured,
                        parameterScope, params,
                        bodyScope, body
                    });

                // TODO: Emit LazyFunctionDeclaration
                // when appropriate.
                return S.EagerFunctionDeclaration.make({
                    isAsync, isGenerator, name,
                    directives, contents
                });
            });
        });
    }

    liftFormalParameters(json: any): S.FormalParameters {
        assertNodeType(json, 'FormalParameters');
        return this.cx.bindParameters(() => {
            const items = json.items.map(
                            i => this.liftParameter(i));
            const rest: (S.Binding | null) =
                json.rest !== null ?
                    this.liftBinding(json.rest)
                  : null;
            return S.FormalParameters.make({items, rest});
        });
    }
    liftParameter(json: any): S.Parameter {
        // Try to lift a binding
        let binding = this.tryLiftBinding(json);
        if (binding !== null) {
            return binding;
        }

        // TODO: handle other parameter options
        // (BindingWithInitializer)
        throw new MatchError('Parameter', json.type);
    }

    liftIfStatement(json: any): S.IfStatement {
        assertNodeType(json, 'IfStatement');

        const test = this.liftExpression(json.test);
        const consequent = this.liftStatement(
                                    json.consequent);
        const alternate =
            json.alternate !== null ?
                this.liftStatement(json.alternate)
              : null;

        return S.IfStatement.make({test, consequent,
                                   alternate});
    }
    liftWhileStatement(json: any): S.WhileStatement {
        assertNodeType(json, 'WhileStatement');

        const test = this.liftExpression(json.test);
        const body = this.liftStatement(json.body);

        return S.WhileStatement.make({test, body});
    }
    liftDoWhileStatement(json: any): S.DoWhileStatement {
        assertNodeType(json, 'DoWhileStatement');

        const test = this.liftExpression(json.test);
        const body = this.liftStatement(json.body);

        return S.DoWhileStatement.make({test, body});
    }

    liftBlockStatement(json: any): S.Block {
        assertNodeType(json, 'BlockStatement');
        return this.liftBlock(json.block);
    }
    liftBlock(json: any): S.Block {
        assertNodeType(json, 'Block');

        return this.cx.enterBlockScope(s => {
            const statements = json.statements.map(
                                s => this.liftStatement(s));
            const scope = s.extractBlockScope();
            return S.Block.make({scope, statements});
        });
    }
    liftReturnStatement(json: any): S.ReturnStatement {
        assertNodeType(json, 'ReturnStatement');

        const expression =
            json.expression !== null ?
                this.liftExpression(json.expression)
              : null;

        return S.ReturnStatement.make({expression});
    }
    liftForInStatement(json: any): S.ForInStatement {
        assertNodeType(json, 'ForInStatement');

        return this.cx.enterBlockScope((vs: VarScope) => {
            // Lift the expression before the binding so
            // the expression gets scoped before the
            // variable gets bound.
            const right = this.liftExpression(json.right);
            const left = this.liftForInStatementLeft(
                                                json.left);
            const body = this.liftStatement(json.body);

            return S.ForInStatement.make({left, right,
                                         body});
        });
    }
    liftForInStatementLeft(json: any)
      : (S.ForInOfBinding | S.AssignmentTarget)
    {
        const result = this.tryLiftAssignmentTarget(json);
        if (result !== null) {
            return result;
        }

        if (json.type == 'VariableDeclaration') {
            const kind = this.liftVariableDeclarationKind(
                                       json.kind as string);
            if (json.declarators.length != 1) {
                throw new Error(
                    `Invalid ForIn with multiple `
                  + `declarations: `
                  + `${json.declarators.length}.`);
            }

            const decl = json.declarators[0];
            if (decl.type !== 'VariableDeclarator') {
                throw new Error(
                    `Expected VariableDeclarator in `
                  + `ForIn, but got: ${decl.type}.`);
            }

            const binding = this.cx.bindDeclKind(kind,
              () => {
                    return this.liftBinding(decl.binding);
              });

            return S.ForInOfBinding.make({kind, binding});
        }

        throw new MatchError('ForInStatementLeft',
                             json.type);
    }

    liftForStatement(json: any): S.ForStatement {
        assertNodeType(json, 'ForStatement');

        return this.cx.enterBlockScope(bs => {
            const init = this.liftForStatementInit(
                                            json.init);
            const test = (json.test !== null)
                ? this.liftExpression(json.test)
                : null;
            const update = (json.update !== null)
                ? this.liftExpression(json.update)
                : null;
            const body = this.liftStatement(json.body);

            return S.ForStatement.make({
                init, test, update, body
            });
        });
    }
    liftForStatementInit(json: any)
      : (S.VariableDeclaration | S.Expression | null)
    {
        if (json === null) {
            return null;
        }

        if (json.type === 'VariableDeclaration') {
            return this.liftVariableDeclaration(json);
        }

        const expr = this.tryLiftExpression(json);
        if (expr !== null) {
            return expr;
        }

        throw new MatchError('ForStatementInit', json.type);
    }
    liftBreakStatement(json: any): S.BreakStatement {
        assertNodeType(json, 'BreakStatement');
        assertType(json.label, 'string',
                   /* nullable = */ true);

        const label = this.liftLabel(json.label);

        return S.BreakStatement.make({label});
    }
    liftLabel(label: string|null): S.Label|null {
        if (label !== null) {
            this.strings.note(label as string);
        }
        return label as (S.Label|null);
    }
    liftContinueStatement(json: any): S.ContinueStatement {
        assertNodeType(json, 'ContinueStatement');
        assertType(json.label, 'string',
                     /* nullable = */ true);

        const label = this.liftLabel(json.label);

        return S.ContinueStatement.make({label});
    }
    liftTryCatchStatement(json: any): S.TryCatchStatement {
        assertNodeType(json, 'TryCatchStatement');

        const body = this.liftBlock(json.body);
        const catchClause = this.liftCatchClause(
                                    json.catchClause);

        return S.TryCatchStatement.make({
            body, catchClause
        });
    }
    tryLiftCatchClause(json: any): S.CatchClause | null {
        if (json === null) {
            return null;
        } else {
            return this.liftCatchClause(json);
        }
    }
    liftCatchClause(json: any): S.CatchClause {
        assertNodeType(json, 'CatchClause');

        return this.cx.enterParameterScope(bs => {
            const binding = this.cx.bindParameters(() => {
                return this.liftBindingIdentifier(
                                        json.binding);
            });
            const body = this.liftBlock(json.body);
            const bindingScope = bs.extractParameterScope();
            return S.CatchClause.make({
                bindingScope, binding, body
            });
        });
    }

    liftTryFinallyStatement(json: any)
      : S.TryFinallyStatement
    {
        assertNodeType(json, 'TryFinallyStatement');

        const body = this.liftBlock(json.body);

        const catchClause =
            this.tryLiftCatchClause(json.catchClause);

        const finalizer =this.liftBlock(json.finalizer);

        return S.TryFinallyStatement.make({
            body, catchClause, finalizer
        });
    }
    liftThrowStatement(json: any): S.ThrowStatement {
        assertNodeType(json, 'ThrowStatement');

        const expression = this.liftExpression(
                                    json.expression);

        return S.ThrowStatement.make({expression});
    }
    liftSwitchStatement(json: any): S.SwitchStatement {
        assertNodeType(json, 'SwitchStatement');

        const discriminant = this.liftExpression(
                                    json.discriminant);
        const cases = json.cases.map(
                        c => this.liftSwitchCase(c));
        return S.SwitchStatement.make({
            discriminant, cases
        });
    }
    liftSwitchStatementWithDefault(json: any)
      : S.SwitchStatementWithDefault
    {
        assertNodeType(json, 'SwitchStatementWithDefault');

        const discriminant = this.liftExpression(
                                    json.discriminant);

        const preDefaultCases = json.preDefaultCases.map(
          c => {
            return this.liftSwitchCase(c);
          });

        const defaultCase = this.liftSwitchDefault(
                                        json.defaultCase);

        const postDefaultCases = json.preDefaultCases.map(
          c => {
            return this.liftSwitchCase(c);
          });

        return S.SwitchStatementWithDefault.make({
            discriminant,
            preDefaultCases,
            defaultCase,
            postDefaultCases
        });
    }
    liftSwitchCase(json: any): S.SwitchCase {
        assertNodeType(json, 'SwitchCase');

        const test = this.liftExpression(json.test);
        const consequent = json.consequent.map(
                            c => this.liftStatement(c));

        return S.SwitchCase.make({test, consequent});
    }
    liftSwitchDefault(json: any): S.SwitchDefault {
        assertNodeType(json, 'SwitchDefault');

        const consequent = json.consequent.map(
                            c => this.liftStatement(c));

        return S.SwitchDefault.make({consequent});
    }

    liftLabeledStatement(json: any): S.LabelledStatement {
        assertNodeType(json, 'LabeledStatement');
        assertType(json.label, 'string');

        const label = json.label as string;
        this.strings.note(label);

        const body = this.liftStatement(json.body);

        return S.LabelledStatement.make({label, body});
    }
    liftEmptyStatement(json: any): S.EmptyStatement {
        assertNodeType(json, 'EmptyStatement');

        return S.EmptyStatement.make({});
    }

    liftExpression(json: any): S.Expression {
        const expr = this.tryLiftExpression(json);
        if (expr !== null) {
            return expr;
        }
        throw new MatchError('Expression', json.type);
    }
    liftExpressionOrSuper(json: any): S.Expression {
        const expr = this.tryLiftExpression(json);
        if (expr !== null) {
            return expr;
        }
        // TODO: Handle 'Super'.
        throw new MatchError('ExpressionOrSuper',
                             json.type);
    }
    tryLiftExpression(json: any): S.Expression|null {
        switch (json.type as string) {
          case 'CallExpression':
            return this.liftCallExpression(json);
          case 'StaticMemberExpression':
            return this.liftStaticMemberExpression(json);
          case 'IdentifierExpression':
            return this.liftIdentifierExpression(json);
          case 'LiteralStringExpression':
            return this.liftLiteralStringExpression(json);
          case 'LiteralBooleanExpression':
            return this.liftLiteralBooleanExpression(json);
          case 'ObjectExpression':
            return this.liftObjectExpression(json);
          case 'ArrayExpression':
            return this.liftArrayExpression(json);
          case 'FunctionExpression':
            return this.liftFunctionExpression(json);
          case 'AssignmentExpression':
            return this.liftAssignmentExpression(json);
          case 'LiteralNullExpression':
            return this.liftLiteralNullExpression(json);
          case 'UnaryExpression':
            return this.liftUnaryExpression(json);
          case 'BinaryExpression':
            return this.liftBinaryExpression(json);
          case 'ComputedMemberExpression':
            return this.liftComputedMemberExpression(json);
          case 'LiteralNumericExpression':
            return this.liftLiteralNumericExpression(json);
          case 'LiteralRegExpExpression':
            return this.liftLiteralRegExpExpression(json);
          case 'CompoundAssignmentExpression':
            return this.liftCompoundAssignmentExpression(
                                                      json);
          case 'UpdateExpression':
            return this.liftUpdateExpression(json);
          case 'NewExpression':
            return this.liftNewExpression(json);
          case 'ThisExpression':
            return this.liftThisExpression(json);
          case 'ConditionalExpression':
            return this.liftConditionalExpression(json);
          default:
            throw new Error("Unrecognized expression");
        }
    }
    liftCallExpression(json: any): S.CallExpression {
        assertNodeType(json, 'CallExpression');

        // TODO: Check for |super| in callee.
        const callee = this.liftExpression(json.callee);
        const arguments_ =
          (json.arguments as Array<any>)
            .map(s => this.liftExpression(s));
        return S.CallExpression.make({
            callee, arguments: arguments_
        });
    }
    liftStaticMemberExpression(json: any)
      : S.StaticMemberExpression
    {
        assertNodeType(json, 'StaticMemberExpression');
        assertType(json.property, 'string');

        // TODO: Check for |super| in object_.
        const object = this.liftExpression(json.object);
        const property = json.property;
        this.strings.note(property);
        return S.StaticMemberExpression.make({
            object, property
        });
    }
    liftIdentifierExpression(json: any):
      S.IdentifierExpression
    {
        assertNodeType(json, 'IdentifierExpression');
        assertType(json.name, 'string');

        const name = this.liftIdentifier(json.name);

        // Note the use of the identifier.
        this.cx.noteUseName(name);

        return S.IdentifierExpression.make({name});
    }
    liftLiteralStringExpression(json: any)
      : S.LiteralStringExpression
    {
        assertNodeType(json, 'LiteralStringExpression');
        assertType(json.value, 'string');

        const value = json.value as string;
        this.strings.note(value);

        return S.LiteralStringExpression.make({value});
    }
    liftLiteralBooleanExpression(json: any)
      : S.LiteralBooleanExpression
    {
        assertNodeType(json, 'LiteralBooleanExpression');
        assertType(json.value, 'boolean');

        const value = json.value as boolean;

        return S.LiteralBooleanExpression.make({value});
    }
    liftObjectExpression(json: any)
      : S.ObjectExpression
    {
        assertNodeType(json, 'ObjectExpression');

        const properties =
            (json.properties as Array<any>).map(p => {
                return this.liftObjectProperty(p);
            });

        return S.ObjectExpression.make({properties});
    }

    liftObjectProperty(json: any): S.ObjectProperty {
        switch (json.type as string) {
          case 'DataProperty':
            return this.liftDataProperty(json);
          case 'MethodDefinition':
          case 'ShorthandProperty':
          default:
            throw new MatchError('ObjectProperty',
                                 json.type);
        }
    }

    liftDataProperty(json: any): S.DataProperty {
        assertNodeType(json, 'DataProperty');

        const name = this.liftPropertyName(json.name);
        const expression = this.liftExpression(
                                        json.expression);

        return S.DataProperty.make({name, expression});
    }

    liftArrayExpression(json: any): S.ArrayExpression {
        assertNodeType(json, 'ArrayExpression');

        const elements = json.elements.map(
                            e => this.liftArrayElement(e));

        return S.ArrayExpression.make({elements});
    }
    liftArrayElement(json: any)
      : S.Opt<S.SpreadElement | S.Expression>
    {
        // Handle opt.
        if (json === null) {
            return null;
        }

        const expr = this.tryLiftExpression(json);
        if (expr !== null) {
            return expr;
        }

        if (json.type === 'SpreadElement') {
            throw new Error("TODO: Handle SpreadElements" +
                            "in array literals.");
        }

        throw new MatchError('ArrayElement', json.type);
    }
    liftFunctionExpression(json: any)
      : S.FunctionExpression
    {
        assertNodeType(json, 'FunctionExpression');
        assertType(json.isGenerator, 'boolean');
        assertNodeType(json.body, 'FunctionBody');
        assertIsArray(json.body.directives);

        const directives = json.body.directives.map(
                            d => this.liftDirective(d));

        // TODO: Handle isAsync and isThisCaptured
        //       and isFunctionNameCaptured!!
        const isAsync = false;
        const isGenerator = json.isGenerator as boolean;
        const isThisCaptured = false;
        const isFunctionNameCaptured = false;

        return this.cx.enterParameterScope(ps => {
            const name = this.cx.bindParameters(() => {
                return json.name !== null ?
                    this.liftBindingIdentifier(json.name)
                  : null;
            });
            const params =
                this.liftFormalParameters(json.params);

            const parameterScope =
                    ps.extractParameterScope();

            return this.cx.enterVarScope(bs => {

                // ASSERT: FunctionBody is Array<Statement>
                const body =
                    json.body.statements.map(
                        s => this.liftStatement(s));

                const bodyScope = bs.extractVarScope();

                const contents =
                    S.FunctionExpressionContents.make({
                        isThisCaptured,
                        isFunctionNameCaptured,
                        parameterScope, params,
                        bodyScope, body
                    });

                // TODO: Emit SkippableFunctionExpression
                // when appropriate.
                return S.EagerFunctionExpression.make({
                    isAsync, isGenerator, name,
                    directives, contents
                });
            });
        });
    }
    liftAssignmentExpression(json: any)
      : S.AssignmentExpression
    {
        assertNodeType(json, 'AssignmentExpression');

        const binding = this.liftAssignmentTarget(
                                            json.binding);

        const expression = this.liftExpression(
                                        json.expression);

        return S.AssignmentExpression.make({
            binding, expression
        });
    }
    liftAssignmentTarget(json: any): S.AssignmentTarget {
        const result = this.tryLiftAssignmentTarget(json);
        if (result !== null) {
            return result;
        }
        throw new MatchError('AssignmentTarget', json.type);
    }
    tryLiftAssignmentTarget(json: any)
      : S.AssignmentTarget | null
    {
        const simple =
            this.tryLiftSimpleAssignmentTarget(json);
        if (simple !== null) {
            return simple;
        }
        return null;
    }
    liftSimpleAssignmentTarget(json: any)
      : S.SimpleAssignmentTarget
    {
        const target =
            this.tryLiftSimpleAssignmentTarget(json);
        if (target !== null) {
            return target;
        }
        throw new MatchError('SimpleAssignmentTarget',
                             json.type);
    }
    tryLiftSimpleAssignmentTarget(json: any)
      : S.SimpleAssignmentTarget|null
    {
        switch (json.type as string) {
          case 'AssignmentTargetIdentifier':
            return this.liftAssignmentTargetIdentifier(
                                                    json);
          case 'StaticMemberAssignmentTarget':
            return this.liftStaticMemberAssignmentTarget(
                                                      json);
          case 'ComputedMemberAssignmentTarget':
            return this.liftComputedMemberAssignmentTarget(
                                                      json);
          default:
            return null;
        }
    }
    liftAssignmentTargetIdentifier(json: any)
      : S.AssignmentTargetIdentifier
    {
        assertNodeType(json, 'AssignmentTargetIdentifier');
        assertType(json.name, 'string');

        const name = this.liftIdentifier(json.name);

        // Note the use of the identifier.
        this.cx.noteUseName(name);

        return S.AssignmentTargetIdentifier.make({name});
    }
    liftStaticMemberAssignmentTarget(json: any)
      : S.StaticMemberAssignmentTarget
    {
        assertNodeType(json,
                'StaticMemberAssignmentTarget');

        assertType(json.property, 'string');

        const object_ =
            this.liftExpressionOrSuper(json.object);

        const property =
            this.liftIdentifier(json.property);

        return S.StaticMemberAssignmentTarget.make({
            object: object_, property
        });
    }

    liftComputedMemberAssignmentTarget(json: any)
      : S.ComputedMemberAssignmentTarget
    {
        assertNodeType(json,
            'ComputedMemberAssignmentTarget');

        const object_ =
            this.liftExpressionOrSuper(json.object);

        const expression =
            this.liftExpression(json.expression);

        return S.ComputedMemberAssignmentTarget.make({
            object: object_, expression
        });
    }

    liftLiteralNullExpression(json: any)
      : S.LiteralNullExpression
    {
        assertNodeType(json, 'LiteralNullExpression');
        return S.LiteralNullExpression.make({});
    }
    liftUnaryExpression(json: any): S.UnaryExpression {
        assertNodeType(json, 'UnaryExpression');
        assertType(json.operator, 'string');

        const operator = json.operator as S.UnaryOperator;
        this.strings.note(operator as string);

        const operand = this.liftExpression(json.operand);

        return S.UnaryExpression.make({operator, operand});
    }
    liftBinaryExpression(json: any): S.BinaryExpression {
        assertNodeType(json, 'BinaryExpression');
        assertType(json.operator, 'string');

        const operator = json.operator as S.BinaryOperator;
        this.strings.note(operator as string);

        const left = this.liftExpression(json.left);
        const right = this.liftExpression(json.right);

        return S.BinaryExpression.make({
            operator, left, right
        });
    }
    liftComputedMemberExpression(json: any)
      : S.ComputedMemberExpression
    {
        assertNodeType(json, 'ComputedMemberExpression');

        const object_ =
            this.liftExpressionOrSuper(json.object);
        const expression =
            this.liftExpression(json.expression);

        return S.ComputedMemberExpression.make({
            object: object_, expression
        });
    }
    liftLiteralNumericExpression(json: any)
      : S.LiteralNumericExpression
    {
        assertNodeType(json, 'LiteralNumericExpression');
        assertType(json.value, 'number');

        const value = json.value as number;
        return S.LiteralNumericExpression.make({value});
    }
    liftLiteralRegExpExpression(json: any)
      : S.LiteralRegExpExpression
    {
        assertNodeType(json, 'LiteralRegExpExpression');
        assertType(json.pattern, 'string');
        assertType(json.global, 'boolean');
        assertType(json.ignoreCase, 'boolean');
        assertType(json.multiLine, 'boolean');
        assertType(json.unicode, 'boolean');
        assertType(json.sticky, 'boolean');

        const pattern = json.pattern as string;
        this.strings.note(pattern);

        const flagArray: Array<string> = [];
        if (json.global) { flagArray.push('g'); }
        if (json.ignoreCase) { flagArray.push('i'); }
        if (json.multiLine) { flagArray.push('m'); }
        if (json.unicode) { flagArray.push('u'); }
        if (json.sticky) { flagArray.push('y'); }
        const flags = flagArray.join();
        this.strings.note(flags);

        return S.LiteralRegExpExpression.make({
            pattern, flags
        });
    }
    liftCompoundAssignmentExpression(json: any)
      : S.CompoundAssignmentExpression
    {
        assertNodeType(json,
            'CompoundAssignmentExpression');

        assertType(json.operator, 'string');

        const operator =
            json.operator as S.CompoundAssignmentOperator;

        this.strings.note(operator as string);

        const binding =
            this.liftSimpleAssignmentTarget(json.binding);

        const expression =
            this.liftExpression(json.expression);

        return S.CompoundAssignmentExpression.make({
            operator, binding, expression
        });
    }

    liftUpdateExpression(json: any): S.UpdateExpression {
        assertNodeType(json, 'UpdateExpression');
        assertType(json.isPrefix, 'boolean');
        assertType(json.operator, 'string');

        const isPrefix = json.isPrefix as boolean;
        const operator = json.operator as S.UpdateOperator;
        this.strings.note(operator as string);

        const operand =
            this.liftSimpleAssignmentTarget(json.operand);

        return S.UpdateExpression.make({
            isPrefix, operator, operand
        });
    }
    liftNewExpression(json: any): S.NewExpression {
        assertNodeType(json, 'NewExpression');

        const callee = this.liftExpression(json.callee);
        const arguments_ =
            json.arguments.map(s => this.liftExpression(s));

        return S.NewExpression.make({
            callee, arguments: arguments_
        });
    }
    liftThisExpression(json: any): S.ThisExpression {
        assertNodeType(json, 'ThisExpression');
        return S.ThisExpression.make({});
    }
    liftConditionalExpression(json: any)
      : S.ConditionalExpression
    {
        assertNodeType(json, 'ConditionalExpression');

        const test = this.liftExpression(json.test);

        const consequent =
            this.liftExpression(json.consequent);

        const alternate =
            this.liftExpression(json.alternate);

        return S.ConditionalExpression.make({
            test, consequent, alternate
        });
    }

    liftPropertyName(json: any): S.PropertyName {
        switch (json.type as string) {
          case 'StaticPropertyName':
            return this.liftStaticPropertyName(json);
          default:
            throw new MatchError('PropertyName', json.type);
        }
    }

    liftStaticPropertyName(json: any)
      : S.LiteralPropertyName
    {
        assertNodeType(json, 'StaticPropertyName');
        assertType(json.value, 'string');

        const value = json.value as string;
        this.strings.note(value);

        return S.LiteralPropertyName.make({value});
    }
}
