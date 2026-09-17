/**
 * @file C# grammar for tree-sitter
 * @author Max Brunsfeld <maxbrunsfeld@gmail.com>
 * @author Damien Guard <damieng@gmail.com>
 * @author Amaan Qureshi <amaanq12@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const PREC = {
  GENERIC: 19,
  DOT: 18,
  INVOCATION: 18,
  POSTFIX: 18,
  PREFIX: 17,
  UNARY: 17,
  CAST: 17,
  RANGE: 16,
  SWITCH: 15,
  WITH: 14,
  MULT: 13,
  ADD: 12,
  SHIFT: 11,
  REL: 10,
  EQUAL: 9,
  AND: 8,
  XOR: 7,
  OR: 6,
  LOGICAL_AND: 5,
  LOGICAL_OR: 4,
  COALESCING: 3,
  CONDITIONAL: 2,
  ASSIGN: 1,
  SELECT: 0,
};

const decimalDigitSequence = /([0-9][0-9_]*[0-9]|[0-9])/;

const stringEncoding = /(u|U)8/;

export default grammar({
  name: 'c_sharp',

  conflicts: $ => [
    // FORK: rule 20 — `T a, b;` and `T a, b =\n#if X\n e;\n#endif` share every
    // token up to the last declarator; GLR carries both until the `=`.
    [$._variable_declaration_with_tail, $.variable_declaration],
    // FORK: rule 21 — a section's statement list may end at a `#if` that holds
    // the NEXT section, or continue into a `#if` that holds statements; and
    // `default` may open a section or an expression statement. All decided by
    // the token after the `#if` line, which is one token more than LR(1) has.
    [$.switch_section],
    // FORK: rule 23 — see dangling_if.
    [$.if_statement, $.dangling_if],
    // FORK (fork21): `[method: …]` opens an attribute list or names an
    // indexer's argument; the tokens after decide.
    [$.attribute_target_specifier, $._reserved_identifier],
    // FORK (fork22): a `#if` opening with attribute lists holds either the
    // lists alone or a declaration they decorate; the token after decides.
    [$._attribute_list, $.preproc_if_in_attribute_list],
    [$._attribute_list, $.preproc_else_in_attribute_list],
    // FORK (fork22): the same for a `#if` opening with modifiers.
    [$._modifier, $.preproc_if_in_modifier],
    // FORK (fork23): a `#if` after a method's parameter list holds a where
    // clause (rule 28) or the body (rule 2); the header's end is decided by it.
    [$._method_header],
    // FORK (fork23): a conditional access is a primary (a receiver) and, since
    // C# 14, an lvalue; what follows it decides.
    [$.lvalue_expression, $._member_access_receiver],
    // FORK (fork23): a `#if` after a where clause continues it, holds the next
    // clause, or holds the body; the branch's first token decides.
    [$.type_parameter_constraints_clause],
    [$._simple_name, $.generic_name],
    [$._simple_name, $.type_parameter],
    [$._simple_name, $.subpattern],

    [$.tuple_element, $.type_pattern],
    [$.tuple_element, $.using_variable_declarator],
    [$.tuple_element, $.declaration_expression],

    [$.tuple_pattern, $.parameter],
    [$.tuple_pattern, $._simple_name],

    [$.lvalue_expression, $._name],
    [$.parameter, $.lvalue_expression],

    [$.type, $.attribute],
    [$.type, $.nullable_type],
    [$.type, $.nullable_type, $.array_creation_expression],
    [$.type, $._array_base_type],
    [$.type, $._array_base_type, $.array_creation_expression],
    [$.type, $.array_creation_expression],
    [$.type, $._pointer_base_type],

    [$.qualified_name, $.member_access_expression],
    [$.qualified_name, $.explicit_interface_specifier],

    [$._array_base_type, $.stackalloc_expression],

    // FORK: `_constant_pattern_operand` is the factored body of
    // constant_pattern, shared with relational_pattern; the conflicts follow it.
    [$._constant_pattern_operand, $.non_lvalue_expression],
    [$._constant_pattern_operand, $._expression_statement_expression],
    [$._constant_pattern_operand, $.lvalue_expression],
    [$._constant_pattern_operand, $._name],
    [$._constant_pattern_operand, $.lvalue_expression, $._name],
    // FORK: after `is <` a name followed by `(` is an invocation operand or a
    // type; the same pair constant_pattern already tolerates through _name.
    [$.type, $._name_invocation_pattern],
    [$.generic_name, $._object_creation_generic_type],
    [$.expression, $.assignment_expression],
    [$.generic_name, $._generic_call_name],
    [$._simple_name, $.generic_name, $._generic_call_name],
    [$._simple_name, $.generic_name, $._object_creation_generic_type, $._object_creation_qualified_generic_type],
    [$._constant_pattern_operand, $._member_access_receiver],
    [$._expression_statement_expression, $._member_access_receiver],
    [$.expression, $._member_access_receiver],
    [$.non_lvalue_expression, $._member_access_receiver],
    [$._simple_name, $.generic_name, $._object_creation_generic_type],

    [$.type, $._name_invocation_pattern, $.recursive_pattern],
    [$.attribute, $.type, $._name_invocation_pattern, $.recursive_pattern],

    [$.parenthesized_pattern, $._parenthesized_pattern_with_designation],

    [$.expression_element, $.argument],
    [$.spread_element, $.range_expression],
    [$.collection_expression, $.list_pattern],

    // FORK (fork25, rule 37): `extension` is a contextual keyword. At `extension (`
    // in a type body, `extension` is either the start of an extension BLOCK or an
    // ordinary name beginning some other member; GLR carries both until the
    // declaration_list decides.
    // FORK (fork26, rule 39): after `try { }` a `#if` is either a #if HOLDING
    // catch clauses — the try continues — or a statement-level #if after the try
    // has ended. Both are legal and the branch's first token decides; GLR
    // carries both until it arrives.
    [$.try_statement],
    [$.extension_declaration, $._reserved_identifier],
    [$._reserved_identifier, $.modifier],
    [$.modifier, $._anonymous_function_modifier, $._reserved_identifier],
    // FORK: in expression position `async` is the start of an async lambda or
    // an identifier, and the set is exactly these two. Undeclared, the pair was
    // resolved statically by the modifier's prec(-1), so every async lambda read
    // `async` as its return type and `async Task (x) => …` was an error.
    [$._anonymous_function_modifier, $._reserved_identifier],
    // FORK: rule 14's operator form — before a `#if`, the operand of `is` is
    // a constant pattern, a chain's receiver, or an operator form's left.
    [$._constant_pattern_operand, $._expression_statement_expression, $._member_access_receiver],
    [$._constant_pattern_operand, $.non_lvalue_expression, $._member_access_receiver],
    // FORK: `async static …` in a block is a local function or a lambda with
    // two modifiers until the parameter list says which.
    [$.modifier, $._anonymous_function_modifier],
    [$._reserved_identifier, $.scoped_type],
    [$._reserved_identifier, $.implicit_type],
    [$._reserved_identifier, $.from_clause],
    [$._reserved_identifier, $.implicit_type, $.var_pattern],
    [$._reserved_identifier, $.type_parameter_constraint],
    [$._reserved_identifier, $.parameter, $.scoped_type],
    [$._reserved_identifier, $.parameter],
    [$._simple_name, $.parameter],
    [$.tuple_element, $.parameter, $.declaration_expression],
    [$.parameter, $.tuple_element],

    [$.event_declaration, $.variable_declarator],

    [$.base_list],
    [$.using_directive, $.modifier],
    [$.using_directive],

    [$._constructor_declaration_initializer, $._simple_name],

    // FORK: `var (` is a declaration expression's type or the start of a
    // deconstruction declaration, and one token cannot tell them apart.
    [$.variable_declaration, $.type],
    // FORK: inside a constant pattern an arithmetic operand is either the
    // pattern's own binary rule or an ordinary binary_expression feeding it;
    // both are aliased to binary_expression, so the trees are the same.
    [$._constant_pattern_binary_expression, $.binary_expression],
    // FORK: `M()` at statement level is the statement's expression or the
    // left of an assignment through a ref return; one token cannot decide.
    [$.lvalue_expression, $._expression_statement_expression],
  ],

  externals: $ => [
    $._optional_semi,
    $.interpolation_regular_start,
    $.interpolation_verbatim_start,
    $.interpolation_raw_start,
    $.interpolation_start_quote,
    $.interpolation_end_quote,
    $.interpolation_open_brace,
    $.interpolation_close_brace,
    $.interpolation_string_content,
    // FORK: see preproc_pragma.
    $._pragma_end,
    $.raw_string_start,
    $.raw_string_end,
    $.raw_string_content,
  ],

  extras: $ => [
    /[\s\u00A0\uFEFF\u3000]+/,
    $.comment,
    $.preproc_region,
    $.preproc_endregion,
    $.preproc_line,
    $.preproc_pragma,
    $.preproc_nullable,
    $.preproc_error,
    $.preproc_warning,
    $.preproc_define,
    $.preproc_undef,
  ],

  inline: $ => [
    $._namespace_member_declaration,
    $._object_creation_type,
    $._nullable_base_type,
    $._parameter_type_with_modifiers,
    $._top_level_item_no_statement,
  ],

  precedences: $ => [
    [$._anonymous_object_member_declarator, $._simple_name],
    [$.block, $.initializer_expression],
  ],

  supertypes: $ => [
    $.declaration,
    $.expression,
    $.non_lvalue_expression,
    $.lvalue_expression,
    $.literal,
    $.statement,
    $.type,
    $.type_declaration,
    $.pattern,
  ],

  word: $ => $._identifier_token,

  rules: {
    compilation_unit: $ => seq(
      optional($.shebang_directive),
      repeat($._top_level_item),
    ),

    _top_level_item: $ => prec(2, choice(
      $._top_level_item_no_statement,
      $.global_statement,
    )),

    _top_level_item_no_statement: $ => choice(
      $.extern_alias_directive,
      $.using_directive,
      $.global_attribute,
      alias($.preproc_if_in_top_level, $.preproc_if),
      $._namespace_member_declaration,
      $.file_scoped_namespace_declaration,
    ),

    global_statement: $ => prec(1, $.statement),

    extern_alias_directive: $ => seq('extern', 'alias', field('name', $.identifier), ';'),

    using_directive: $ => seq(
      optional('global'),
      'using',
      choice(
        seq(
          optional('unsafe'),
          field('name', $.identifier),
          '=',
          $.type,
        ),
        seq(
          repeat(choice('static', 'unsafe')),
          $._name,
        ),
      ),
      ';',
    ),

    global_attribute: $ => seq(
      '[',
      choice('assembly', 'module'),
      ':',
      commaSep1($.attribute),
      optional(','),
      ']',
    ),

    attribute: $ => seq(
      field('name', $._name),
      optional($.attribute_argument_list),
    ),

    attribute_argument_list: $ => prec(-1, seq(
      '(',
      commaSep($.attribute_argument),
      ')',
    )),

    attribute_argument: $ => prec(-1, seq(
      optional(prec(1, seq(field('name', $.identifier), choice(':', '=')))),
      $.expression,
    )),

    attribute_list: $ => seq(
      '[',
      optional($.attribute_target_specifier),
      commaSep1($.attribute),
      optional(','),
      ']',
    ),

    _attribute_list: $ => choice($.attribute_list, $.preproc_if_in_attribute_list),

    attribute_target_specifier: _ => seq(
      choice('field', 'event', 'method', 'param', 'property', 'return', 'type', 'typevar'),
      ':',
    ),

    _namespace_member_declaration: $ => choice(
      $.namespace_declaration,
      $.type_declaration,
    ),

    namespace_declaration: $ => seq(
      'namespace',
      field('name', $._name),
      field('body', $.declaration_list),
      $._optional_semi,
    ),

    file_scoped_namespace_declaration: $ => seq(
      'namespace',
      field('name', $._name),
      ';',
    ),

    type_declaration: $ => choice(
      $.class_declaration,
      $.struct_declaration,
      $.enum_declaration,
      $.interface_declaration,
      $.delegate_declaration,
      $.record_declaration,
    ),

    // FORK (fork23, rule 32): a declaration HEADER under a `#if`, the body after
    // the `#endif` — `#if NET\n public sealed partial class X<T> : A, B, C\n#else
    // \n public sealed partial class X<T> : A, B\n#endif\n { … }`, and the same on
    // a method or a constructor. Each branch holds one whole header; the taken
    // branch's is the declaration's, read through `headerOf` in the extractor.
    // ImmutableHashSet_1.cs and ImmutableSortedSet_1.cs (types),
    // MessageTemplateProcessor.cs, StatusBarBehavior.shared.cs,
    // PropertyBinder.cs (methods) and TestFixtureBase.cs (a constructor) were
    // whole-file ERRORs for it.
    class_declaration: $ => seq(
      choice(
        $._class_declaration_initializer,
        // Attributes may precede the `#if`; the branch then starts at the
        // modifiers (ImmutableHashSet_1.cs).
        seq(repeat($._attribute_list), alias($.preproc_if_in_class_header, $.preproc_if)),
      ),
      $._declaration_list_body,
    ),
    class_header: $ => $._class_declaration_initializer,

    _class_declaration_initializer: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      'class',
      field('name', $.identifier),
      repeat(choice($.type_parameter_list, $.parameter_list, $._base_list)),
      repeat($._constraints_clause_item),
    ),

    struct_declaration: $ => seq(
      $._struct_declaration_initializer,
      $._declaration_list_body,
    ),

    _struct_declaration_initializer: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      // FORK (fork20): modifiers may FOLLOW `ref` — `readonly ref partial
      // struct Span2D<T>`, `ref readonly partial struct`: upstream took `ref`
      // as the last word before `struct`, and Span2D{T}.cs (46 KB) was one
      // ERROR from its first attribute down.
      optional(seq('ref', repeat($._modifier))),
      'struct',
      field('name', $.identifier),
      repeat(choice($.type_parameter_list, $.parameter_list, $._base_list)),
      repeat($._constraints_clause_item),
    ),

    enum_declaration: $ => seq(
      $._enum_declaration_initializer,
      choice(
        seq(field('body', $.enum_member_declaration_list), $._optional_semi),
        ';',
      ),
    ),

    _enum_declaration_initializer: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      'enum',
      field('name', $.identifier),
      optional($.base_list),
    ),

    enum_member_declaration_list: $ => seq(
      '{',
      commaSep(choice(
        $.enum_member_declaration,
        alias($.preproc_if_in_enum_member_declaration, $.preproc_if),
      )),
      optional(','),
      '}',
    ),

    enum_member_declaration: $ => seq(
      repeat($._attribute_list),
      field('name', $.identifier),
      optional(seq('=', field('value', $.expression))),
    ),

    interface_declaration: $ => seq(
      $._interface_declaration_initializer,
      $._declaration_list_body,
    ),

    _interface_declaration_initializer: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      'interface',
      field('name', $.identifier),
      field('type_parameters', optional($.type_parameter_list)),
      optional($._base_list),
      repeat($._constraints_clause_item),
    ),

    delegate_declaration: $ => seq(
      $._delegate_declaration_initializer,
      repeat($._constraints_clause_item),
      ';',
    ),

    _delegate_declaration_initializer: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      'delegate',
      field('type', $.type),
      field('name', $.identifier),
      field('type_parameters', optional($.type_parameter_list)),
      field('parameters', $.parameter_list),
    ),

    record_declaration: $ => seq(
      $._record_declaration_initializer,
      $._declaration_list_body,
    ),

    _record_declaration_initializer: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      'record',
      optional(choice('class', 'struct')),
      field('name', $.identifier),
      repeat(choice($.type_parameter_list, $.parameter_list)),
      optional(choice(
        alias($.record_base, $.base_list),
        alias($.preproc_if_in_record_base, $.preproc_if),
      )),
      repeat($._constraints_clause_item),
    ),

    // FORK: a `#if` that wraps the whole base list — `class C\n#if X\n : I\n#endif`
    // — is the multi-targeting idiom for an interface that exists on one
    // target only. Upstream has no rule for it and recovers by displacing the
    // class NAME into an ERROR and taking the directive's symbol as the name,
    // for any symbol longer than one character.
    _base_list: $ => choice(
      $.base_list,
      alias($.preproc_if_in_base_list, $.preproc_if),
    ),

    record_base: $ => choice(
      seq(':', commaSep1($._name)),
      seq(':', $.primary_constructor_base_type, optional(seq(',', commaSep1($._name)))),
    ),

    _declaration_list_body: $ => choice(
      seq(field('body', $.declaration_list), $._optional_semi),
      ';',
    ),

    primary_constructor_base_type: $ => seq(
      field('type', $._name),
      $.argument_list,
    ),

    // FORK (fork22): MODIFIERS under a `#if` — `#if NET\n public\n#else\n
    // internal\n#endif\n sealed class NullabilityInfo`, `#if NET_4_0\n protected
    // internal virtual\n#else\n internal\n#endif\n string M()`. Fifty-seven sites,
    // fifty-three in the BCL, and upstream lost the whole declaration and
    // often the file. Every place a declaration repeats its modifiers admits
    // the `#if`; the branch holds one or more modifiers.
    _modifier: $ => choice(
      $.modifier,
      alias($.preproc_if_in_modifier, $.preproc_if),
    ),

    modifier: _ => prec.right(choice(
      'abstract',
      'async',
      'const',
      'extern',
      'file',
      'fixed',
      'internal',
      'new',
      // FORK (fork23): the BCL's `safe` modifier — `public safe byte AsByte;`,
      // `public extern safe String(char[] value);` (the memory-safety
      // annotation dotnet/runtime builds with; eight files, whole-file ERRORs
      // for it). No corpus file uses `safe` as an identifier.
      'safe',
      'override',
      'partial',
      'private',
      'protected',
      'public',
      'readonly',
      'required',
      // 'ref',     // `ref` as a modifier can only be used on struct declarations. Other than that it's a ref type or a ref parameter in a declaration.
      // 'scoped',  // `scoped` is either part of a scoped type or a scoped parameter. Both of which are handled outside of `modifier`.
      'sealed',
      'static',
      'unsafe',
      'virtual',
      'volatile',

    )),

    type_parameter_list: $ => seq('<', commaSep1($.type_parameter), '>'),

    type_parameter: $ => seq(
      repeat($._attribute_list),
      optional(choice('in', 'out')),
      field('name', $.identifier),
    ),

    // FORK: rule 22 — a base-list CONTINUATION under a `#if`, leading comma:
    // `class C : A, B\n#if X\n , C\n#endif\n {`. Eighteen sites in three strata
    // (serilog 8, eShop's protobuf-generated 6, newtonsoft 4). Upstream left
    // `, C` and the directives as ERRORs before the body. The branch holds
    // `, type` runs; the extractor reads the taken branch's fragment as more
    // heritage rows.
    base_list: $ => seq(
      ':',
      // FORK (fork20): and the TRAILING-comma form, rule 17's shape — `: ISet<T>,
      // \n#if NET\n IReadOnlySet<T>,\n#endif\n IReadOnlyCollection<T>` (FrozenSet.cs).
      repeat(choice(
        seq($.type, optional($.argument_list), ','),
        alias($.preproc_if_in_base_fragment, $.preproc_if),
      )),
      seq($.type, optional($.argument_list)),
      repeat(alias($.preproc_if_in_base_continuation, $.preproc_if)),
    ),
    base_continuation: $ => repeat1(seq(',', $.type, optional($.argument_list))),
    base_fragment: $ => repeat1(seq($.type, optional($.argument_list), ',')),

    // FORK (fork20): a `where` clause under a `#if` between a signature and
    // its body — `M<T>(T v)\n#if NET9_0_OR_GREATER\n where T : allows ref
    // struct\n#endif\n { … }`: the anti-constraint is C# 13, so it is guarded
    // at every one of its 11 BCL sites. Every place a declaration repeats
    // its clauses admits the `#if`, and the type-parameter extractor reads
    // the taken branch's clauses.
    _constraints_clause_item: $ => choice(
      $.type_parameter_constraints_clause,
      alias($.preproc_if_in_constraints_clause, $.preproc_if),
    ),

    type_parameter_constraints_clause: $ => seq(
      'where',
      $.identifier,
      ':',
      commaSep1($.type_parameter_constraint),
      // FORK (fork23): a CONSTRAINT continuation under a `#if`, leading comma —
      // `where T : notnull\n#if NET\n , allows ref struct\n#endif` — five BCL
      // files; rule 22's shape on a where clause.
      repeat(alias($.preproc_if_in_constraint_continuation, $.preproc_if)),
    ),
    constraint_continuation: $ => repeat1(seq(',', $.type_parameter_constraint)),

    type_parameter_constraint: $ => choice(
      seq('class', optional('?')),
      'struct',
      'notnull',
      'unmanaged',
      // FORK: rule 24 — C# 13's anti-constraint `where T : allows ref struct`.
      // Twenty-six files in one stratum; upstream stopped at `allows` and the
      // rest of the clause was an ERROR. `allows` is a contextual keyword and
      // stays an identifier elsewhere, as `unmanaged` and `notnull` do.
      seq('allows', 'ref', 'struct'),
      $.constructor_constraint,
      field('type', $.type),
    ),

    constructor_constraint: _ => seq('new', '(', ')'),

    operator_declaration: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      field('type', $.type),
      optional($.explicit_interface_specifier),
      'operator',
      optional('checked'),
      field('operator', choice(
        '!',
        '~',
        '++',
        '--',
        'true',
        'false',
        '+', '-',
        '*', '/',
        '%', '^',
        '|', '&',
        '<<', '>>', '>>>',
        '==', '!=',
        '>', '<',
        '>=', '<=',
      )),
      field('parameters', $.parameter_list),
      $._function_body,
    ),

    conversion_operator_declaration: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      choice(
        'implicit',
        'explicit',
      ),
      repeat1(choice( // Intentionally structured this way for grammar size
        $.explicit_interface_specifier,
        'operator',
        'checked',
      )),
      field('type', $.type),
      field('parameters', $.parameter_list),
      $._function_body,
    ),

    declaration_list: $ => seq(
      '{',
      repeat($.declaration),
      '}',
    ),

    // FORK: rule 37 (fork25) — C# 14 EXTENSION MEMBERS.
    //
    //     extension<T>(Vector128<T>)
    //         where T : IFloatingPointConstants<T>
    //     {
    //         public static Vector128<T> E { [Intrinsic] get => Create(T.E); }
    //     }
    //
    // The successor to the `this`-parameter extension method: the receiver is
    // named ONCE for the whole block, and the members inside are extension
    // members of it — including instance PROPERTIES and OPERATORS, which the
    // `this`-parameter form could not express at all.
    //
    // Upstream has no rule for it, and the failure is not local: the block sits
    // directly in a type body, so recovery took the WHOLE FILE. Five files in
    // the BCL stratum, every one a 200-260 KB single ERROR node, and 4,305 of
    // the stratum's 4,384 missing call sites — 98.2% of them — were inside
    // them. Roslyn under C# 13 recovers far enough to bind the member bodies
    // and reported 936 calls in Vector128.cs alone, so this is a parser gap
    // and not a configuration disagreement.
    extension_declaration: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      'extension',
      field('type_parameters', optional($.type_parameter_list)),
      field('parameters', $.extension_parameter_list),
      repeat($.type_parameter_constraints_clause),
      field('body', $.declaration_list),
    ),

    // The receiver. Two forms, and the difference is what the block may hold:
    // `extension(string source)` names the receiver and its members may be
    // INSTANCE members; `extension(Vector128<T>)` names only the TYPE and its
    // members are STATIC. A bare identifier fits both readings — `extension(Vec)`
    // could be a parameter named `Vec` with no type — and C# says it is the
    // TYPE, so the type alternative carries a dynamic point.
    extension_parameter_list: $ => seq(
      '(',
      optional(choice(
        $.parameter,
        prec.dynamic(1, field('receiver_type', $.type)),
      )),
      ')',
    ),

    declaration: $ => choice(
      $.class_declaration,
      $.struct_declaration,
      $.enum_declaration,
      $.delegate_declaration,
      $.field_declaration,
      $.method_declaration,
      $.event_declaration,
      $.event_field_declaration,
      $.record_declaration,
      $.constructor_declaration,
      $.destructor_declaration,
      $.indexer_declaration,
      $.interface_declaration,
      $.namespace_declaration,
      $.operator_declaration,
      $.conversion_operator_declaration,
      $.property_declaration,
      $.using_directive,
      // FORK: rule 37 (fork25) — the C# 14 extension BLOCK.
      $.extension_declaration,
      $.preproc_if,
    ),

    field_declaration: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      choice(
        seq($.variable_declaration, ';'),
        // FORK: rule 20 — `T x =\n#if X\n a;\n#else\n b;\n#endif`: the `;`
        // is inside each branch. Twenty-nine sites in four strata.
        alias($._variable_declaration_with_tail, $.variable_declaration),
      ),
    ),

    constructor_declaration: $ => seq(
      choice(
        $._constructor_declaration_initializer,
        // FORK (fork23, rule 32) — see class_declaration.
        // …and the `: this()` / `: base(…)` may follow the `#endif` (Lock.cs).
        seq(repeat($._attribute_list), alias($.preproc_if_in_constructor_header, $.preproc_if), optional($.constructor_initializer)),
      ),
      $._function_body,
    ),
    constructor_header: $ => $._constructor_declaration_initializer,

    _constructor_declaration_initializer: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      field('name', $.identifier),
      field('parameters', $.parameter_list),
      optional($.constructor_initializer),
    ),

    destructor_declaration: $ => seq(
      repeat($._attribute_list),
      optional('extern'),
      '~',
      field('name', $.identifier),
      field('parameters', $.parameter_list),
      $._function_body,
    ),

    method_declaration: $ => seq(
      choice(
        $._method_header,
        // FORK (fork23, rule 32) — see class_declaration.
        seq(repeat($._attribute_list), alias($.preproc_if_in_method_header, $.preproc_if)),
      ),
      $._function_body,
    ),
    method_header: $ => $._method_header,
    _method_header: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      // FORK (fork22): a return TYPE under a `#if` — `private static async\n#if
      // NET\n ValueTask<T>\n#else\n Task<T>\n#endif\n ReadToEndAsync(…)`. One
      // corpus site, but with modifiers admitting a `#if` (rule 31) its recovery
      // went from local to the whole method.
      field('returns', choice($.type, alias($.preproc_if_in_return_type, $.preproc_if))),
      optional($.explicit_interface_specifier),
      field('name', $.identifier),
      field('type_parameters', optional($.type_parameter_list)),
      field('parameters', $.parameter_list),
      repeat($._constraints_clause_item),
    ),

    event_declaration: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      'event',
      field('type', $.type),
      optional($.explicit_interface_specifier),
      field('name', $.identifier),
      choice(
        field('accessors', $.accessor_list),
        ';',
      ),
    ),

    event_field_declaration: $ => prec.dynamic(1, seq(
      repeat($._attribute_list),
      repeat($._modifier),
      'event',
      $.variable_declaration,
      ';',
    )),

    accessor_list: $ => seq(
      '{',
      repeat($.accessor_declaration),
      '}',
    ),

    accessor_declaration: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      field('name', choice('get', 'set', 'add', 'remove', 'init', $.identifier)),
      $._function_body,
    ),

    indexer_declaration: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      field('type', $.type),
      optional($.explicit_interface_specifier),
      'this',
      field('parameters', $.bracketed_parameter_list),
      choice(
        field('accessors', $.accessor_list),
        seq(field('value', $.arrow_expression_clause), ';'),
        // FORK: rule 19 — see _function_body.
        field('value', alias($.preproc_arrow_expression_clause, $.arrow_expression_clause)),
      ),
    ),

    bracketed_parameter_list: $ => seq(
      '[',
      sep(choice($.parameter, $._parameter_array), ','),
      ']',
    ),

    property_declaration: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      field('type', $.type),
      optional($.explicit_interface_specifier),
      field('name', $.identifier),
      choice(
        seq(
          field('accessors', $.accessor_list),
          optional(seq('=', field('value', $.expression), ';')),
        ),
        seq(
          field('value', $.arrow_expression_clause),
          ';',
        ),
        // FORK: rule 19 — see _function_body.
        field('value', alias($.preproc_arrow_expression_clause, $.arrow_expression_clause)),
        // FORK: the same one-header-two-bodies shape as `_function_body`, on
        // a property. Upstream recovered a property with an ERROR child and
        // the `#else` body as a stray ERROR in the declaration list.
        alias($.preproc_if_in_property_body, $.preproc_if),
      ),
    ),

    explicit_interface_specifier: $ => prec(PREC.DOT, seq(
      $._name,
      '.',
    )),

    // FORK: rule 17 — a `#if` in a PARAMETER LIST whose branch holds
    // `T a,` (one or more, each with its comma): `M(\n#if NET\n ReadOnlySpan<char>
    // s,\n#else\n string s,\n#endif\n out T r)`. Upstream read the `#if` as the
    // first parameter's ATTRIBUTE LIST with a MISSING #endif, left `#else` and
    // `#endif` as ERRORs, and emitted BOTH branches' parameters as siblings —
    // a method of arity 3 declared with arity 2, and arity is identity. The
    // branch content is a run ending in a comma; a branch holding a whole
    // last parameter with no comma is not a shape the corpus has.
    parameter_list: $ => seq(
      '(',
      repeat(choice(
        seq(choice($.parameter, $._parameter_array), ','),
        alias($.preproc_if_in_parameter, $.preproc_if),
      )),
      optional(choice($.parameter, $._parameter_array)),
      ')',
    ),
    parameter_fragment: $ => repeat1(seq(choice($.parameter, $._parameter_array), ',')),

    _parameter_type_with_modifiers: $ => seq(
      repeat(prec.left(alias(
        choice('this', 'scoped', 'ref', 'out', 'in', 'readonly'),
        $.modifier,
      ))),
      field('type', $.type),
    ),

    parameter: $ => seq(
      repeat($._attribute_list),
      optional($._parameter_type_with_modifiers),
      field('name', $.identifier),
      optional(seq('=', $.expression)),
    ),

    _parameter_array: $ => seq(
      repeat($._attribute_list),
      'params',
      field('type', $.type),
      field('name', $.identifier),
    ),

    constructor_initializer: $ => seq(
      ':',
      choice('base', 'this'),
      $.argument_list,
    ),

    // FORK: rule 18 — rule 17's shape in an ARGUMENT LIST: `F(a,\n#if X\n b,
    // \n#else\n c,\n#endif\n d)`. Upstream put the `#if` in the second
    // argument through preproc_if_in_expression, left each branch's comma as
    // an ERROR, and pushed `d` — the argument after the #endif — into an ERROR
    // of its own: the call lost its last argument. A branch holding a whole
    // argument with NO comma is the existing expression-position path and is
    // not admitted here, so the two never compete.
    argument_list: $ => seq(
      '(',
      repeat(choice(
        seq($.argument, ','),
        alias($.preproc_if_in_argument, $.preproc_if),
      )),
      choice(
        seq(optional($.argument), ')'),
        // The branch CLOSES the call — `F(a,\n#if X\n b, c)\n#else\n d)\n#endif`.
        // Two corpus sites, both with the statement's `;` inside the branch
        // too, which this cannot take; it exists so that recovery from that
        // shape stays LOCAL — without it the fragment stack failed at the
        // `)` and took the whole file.
        alias($.preproc_if_in_argument_close, $.preproc_if),
      ),
    ),
    argument_fragment: $ => repeat1(seq($.argument, ',')),
    // FORK: rule 38 (fork26) — `element ,` runs inside an initializer's #if,
    // the same shape one container over. See initializer_expression.
    initializer_fragment: $ => repeat1(seq($.expression, ',')),
    argument_close_fragment: $ => seq(repeat(seq($.argument, ',')), optional($.argument), ')'),

    tuple_pattern: $ => seq(
      '(',
      commaSep1(choice(
        field('name', $.identifier),
        $.discard,
        $.tuple_pattern,
      )),
      ')',
    ),

    argument: $ => prec(1, seq(
      optional(seq(field('name', $.identifier), ':')),
      optional(choice('ref', 'out', 'in')),
      choice(
        $.expression,
        $.declaration_expression,
      ),
    )),

    block: $ => seq('{', repeat($.statement), '}'),

    arrow_expression_clause: $ => seq('=>', $.expression),

    _function_body: $ => choice(
      field('body', $.block),
      seq(field('body', $.arrow_expression_clause), ';'),
      ';',
      // FORK: rule 19 — `M() =>\n#if X\n a;\n#else\n b;\n#endif`: the arrow is
      // OUTSIDE the #if and each branch holds `expression ;`. Forty-three
      // sites in four strata. Upstream took the branch's expression through
      // preproc_if_in_expression and left each `;` as an ERROR — rows right,
      // file counted as failing to parse.
      field('body', alias($.preproc_arrow_expression_clause, $.arrow_expression_clause)),
      // FORK: rule 36 (fork24) — rule 19's MIRROR. The WHOLE arrow clause is
      // inside the #if and the `;` is after the #endif:
      //
      //     ILogger ForContext<T>()
      //     #if FEATURE_DEFAULT_INTERFACE
      //         => ForContext(typeof(T))
      //     #endif
      //         ;
      //
      // The default-interface-method idiom: a body under the symbol, an
      // ABSTRACT declaration without it, and the `;` shared by both readings —
      // which is exactly why it sits outside. Rule 19 covers `=>` outside and
      // `expression ;` inside; neither it nor preproc_if_in_function_body
      // (which requires the `;` INSIDE the branch) can take this one.
      //
      // 134 of serilog's 153 parse gaps, in one file, under BOTH of its target
      // frameworks — the gap is in the tree whether the branch is taken or not.
      seq(alias($.preproc_if_in_arrow_body, $.preproc_if), ';'),
      // FORK: `M()\n#if X\n => a;\n#else\n => b;\n#endif` — one header, a body
      // per target. Upstream recovers it as a property with an ERROR child and
      // a method named by the next keyword.
      alias($.preproc_if_in_function_body, $.preproc_if),
    ),

    // FORK: rule 19 — see _function_body.
    preproc_arrow_expression_clause: $ => seq(
      '=>',
      alias($.preproc_if_in_expression_tail, $.preproc_if),
    ),
    // FORK: rule 20 — see field_declaration.
    _variable_declaration_with_tail: $ => seq(
      field('type', $.type),
      repeat(seq($.variable_declarator, ',')),
      alias($.preproc_variable_declarator, $.variable_declarator),
    ),
    preproc_variable_declarator: $ => seq(
      field('name', $.identifier),
      optional($.bracketed_argument_list),
      '=',
      alias($.preproc_if_in_expression_tail, $.preproc_if),
    ),

    variable_declaration: $ => choice(
      seq(
        field('type', $.type),
        commaSep1($.variable_declarator),
      ),
      // FORK: `var (a, b) = e` is the only deconstruction DECLARATION; a tuple
      // declarator after any other type is not C#. Allowing it let
      // `Local(x) = value` — a ref-returning call on the left of an
      // assignment — parse as a declaration of type `Local` with a one-element
      // tuple pattern, and the call vanished.
      seq(
        field('type', $.implicit_type),
        commaSep1(alias($._tuple_variable_declarator, $.variable_declarator)),
      ),
    ),

    using_variable_declaration: $ => seq(
      field('type', $.type),
      commaSep1(alias($.using_variable_declarator, $.variable_declarator)),
    ),

    variable_declarator: $ => seq(
      field('name', $.identifier),
      optional($.bracketed_argument_list),
      // FORK: rule 14's mirror at an initializer — see _expression_or_head.
      optional(seq('=', $._expression_or_head)),
    ),

    _tuple_variable_declarator: $ => seq(
      $.tuple_pattern,
      optional(seq('=', $.expression)),
    ),

    using_variable_declarator: $ => seq(
      field('name', $.identifier),
      optional(seq('=', $.expression)),
    ),

    bracketed_argument_list: $ => seq(
      '[',
      commaSep1($.argument),
      optional(','),
      ']',
    ),

    qualified_identifier: $ => sep1($.identifier, '.'),

    _name: $ => choice(
      $.alias_qualified_name,
      $.qualified_name,
      $._simple_name,
    ),

    alias_qualified_name: $ => seq(
      field('alias', $.identifier),
      '::',
      field('name', $._simple_name),
    ),

    _simple_name: $ => choice(
      $.identifier,
      $.generic_name,
    ),

    qualified_name: $ => prec(PREC.DOT, seq(
      field('qualifier', $._name),
      '.',
      field('name', $._simple_name),
    )),

    generic_name: $ => seq($.identifier, $.type_argument_list),

    type_argument_list: $ => seq(
      '<',
      choice(
        repeat(','),
        commaSep1($.type),
      ),
      '>',
    ),

    type: $ => choice(
      $.implicit_type,
      $.array_type,
      $._name,
      $.nullable_type,
      $.pointer_type,
      $.function_pointer_type,
      $.predefined_type,
      $.tuple_type,
      $.ref_type,
      $.scoped_type,
    ),

    implicit_type: _ => prec.dynamic(1, 'var'),

    array_type: $ => seq(
      field('type', $._array_base_type),
      field('rank', $.array_rank_specifier),
    ),

    _array_base_type: $ => choice(
      $.array_type,
      $._name,
      $.nullable_type,
      $.pointer_type,
      $.function_pointer_type,
      $.predefined_type,
      $.tuple_type,
    ),

    array_rank_specifier: $ => seq(
      '[',
      commaSep(optional($.expression)),
      ']',
    ),

    nullable_type: $ => seq(field('type', $._nullable_base_type), '?'),

    _nullable_base_type: $ => choice(
      $.array_type,
      $._name,
      $.predefined_type,
      $.tuple_type,
    ),

    pointer_type: $ => seq(field('type', $._pointer_base_type), '*'),

    _pointer_base_type: $ => choice(
      $._name,
      $.nullable_type,
      $.pointer_type,
      $.function_pointer_type,
      $.predefined_type,
      $.tuple_type,
    ),

    function_pointer_type: $ => seq(
      'delegate',
      '*',
      optional($.calling_convention),
      '<',
      repeat(seq($.function_pointer_parameter, ',')),
      field('returns', $.type),
      '>',
    ),

    calling_convention: $ => choice(
      'managed',
      seq(
        'unmanaged',
        optional(seq(
          '[',
          commaSep1(choice(
            'Cdecl',
            'Stdcall',
            'Thiscall',
            'Fastcall',
            $.identifier,
          )),
          ']',
        )),
      ),
    ),

    function_pointer_parameter: $ => seq(
      optional(choice('ref', 'out', 'in')),
      field('type', $._ref_base_type),
    ),

    predefined_type: _ => token(choice(
      'bool',
      'byte',
      'char',
      'decimal',
      'double',
      'float',
      'int',
      'long',
      'object',
      'sbyte',
      'short',
      'string',
      'uint',
      'ulong',
      'ushort',
      'nint',
      'nuint',
      'void',
    )),

    ref_type: $ => seq(
      'ref',
      optional('readonly'),
      field('type', $.type),
    ),

    _ref_base_type: $ => choice(
      $.implicit_type,
      $._name,
      $.nullable_type,
      $.array_type,
      $.pointer_type,
      $.function_pointer_type,
      $.predefined_type,
      $.tuple_type,
    ),

    scoped_type: $ => seq(
      'scoped',
      field('type', $._scoped_base_type),
    ),

    _scoped_base_type: $ => choice(
      $._name,
      $.ref_type,
    ),

    tuple_type: $ => seq(
      '(',
      commaSep2($.tuple_element),
      ')',
    ),

    // FORK: rule 8's residual (CS-CORPUS-22). `new HashSet<(string Name,
    // string? Schema)>(src)` also reads as `(new HashSet) < (string Name,
    // string? Schema) > (src)` — a tuple EXPRESSION of two declaration
    // expressions, each of which scores a point, so the comparison tied the
    // creation's two and won. A NAMED tuple element scores the same point as
    // the declaration expression it mirrors; the creation's two then decide.
    tuple_element: $ => seq(
      field('type', $.type),
      optional(field('name', prec.dynamic(1, $.identifier))),
    ),

    statement: $ => prec(1, choice(
      $.block,
      $.break_statement,
      $.checked_statement,
      $.continue_statement,
      $.do_statement,
      $.empty_statement,
      $.expression_statement,
      $.fixed_statement,
      $.for_statement,
      $.return_statement,
      $.lock_statement,
      $.yield_statement,
      $.switch_statement,
      $.throw_statement,
      $.try_statement,
      $.unsafe_statement,
      $.using_statement,
      $.foreach_statement,
      $.goto_statement,
      $.labeled_statement,
      $.if_statement,
      $.while_statement,
      $.local_declaration_statement,
      $.local_function_statement,
      alias($.preproc_if_in_top_level, $.preproc_if),
      // FORK: rule 16 — see else_fragment.
      $.else_fragment,
    )),

    break_statement: _ => seq('break', ';'),

    checked_statement: $ => seq(choice('checked', 'unchecked'), $.block),

    continue_statement: _ => seq('continue', ';'),

    do_statement: $ => seq(
      'do',
      field('body', $.statement),
      'while',
      '(',
      field('condition', $.expression),
      ')',
      ';',
    ),

    empty_statement: _ => ';',

    expression_statement: $ => seq($._expression_statement_expression, ';'),

    fixed_statement: $ => seq('fixed', '(', $.variable_declaration, ')', $.statement),

    for_statement: $ => seq(
      'for',
      $._for_statement_conditions,
      field('body', $.statement),
    ),

    _for_statement_conditions: $ => seq(
      '(',
      field('initializer', optional(
        choice($.variable_declaration, commaSep1($.expression)),
      )),
      ';',
      field('condition', optional($.expression)),
      ';',
      field('update', optional(commaSep1($.expression))),
      ')',
    ),

    // FORK: rule 14's mirror at a return value — see _expression_or_head.
    return_statement: $ => seq('return', optional($._expression_or_head), ';'),

    lock_statement: $ => seq('lock', '(', $.expression, ')', $.statement),

    yield_statement: $ => seq(
      'yield',
      choice(
        seq('return', $.expression),
        'break',
      ),
      ';',
    ),

    switch_statement: $ => seq(
      'switch',
      choice(
        seq(
          '(',
          field('value', $.expression),
          ')',
        ),
        field('value', $.tuple_expression),
      ),
      field('body', $.switch_body),
    ),

    // FORK: rule 21 — a `#if` holding switch SECTIONS: `case A: …\n#if X\n case
    // B: …\n#endif\n default: …`. Fifty-one sites in four strata. Upstream read
    // the `#if` at the previous section's statement position and its `case B:`
    // as a local declaration of type `case` followed by a LABELED statement —
    // no error, a phantom local, a phantom label and no case label: a coherent
    // misparse. The section's own statement list still admits a statement-level
    // `#if`; GLR carries both readings until the branch's first token decides.
    switch_body: $ => seq(
      '{',
      repeat(choice(
        $.switch_section,
        alias($.preproc_if_in_switch_section, $.preproc_if),
      )),
      '}',
    ),

    switch_section: $ => seq(
      choice(
        seq(
          'case',
          choice(
            $.expression,
            seq($.pattern, optional($.when_clause)),
          ),
          ':',
        ),
        seq('default', ':'),
        // FORK: rule 21's LABEL form — `case A:\n#if X\n case B:\n#endif\n
        // stmts`: a stacked label under a `#if`, the shared statements after
        // the `#endif`. The branch holds labels only; when a branch holds a
        // label AND statements it is the body form above, and when it holds a
        // label alone both fit and this one, at precedence 1, is the reading —
        // the statements that follow the `#endif` are the section's.
        alias($.preproc_if_in_switch_label, $.preproc_if),
      ),
      repeat($.statement),
    ),
    switch_label: $ => prec(1, seq(
      choice(
        seq(
          'case',
          choice(
            $.expression,
            seq($.pattern, optional($.when_clause)),
          ),
        ),
        'default',
      ),
      ':',
    )),

    throw_statement: $ => seq('throw', optional($.expression), ';'),

    // FORK: rule 39 (fork26) — a `#if` holding CATCH CLAUSES between two others:
    //
    //     catch (NotSupportedException) { … }
    //     #if !NETFX_CORE
    //     catch (ReflectionTypeLoadException e) { … }
    //     #endif
    //
    // A `catch` is not a statement and not an expression, so no existing `#if`
    // rule can hold one and the clause was recovery debris.
    try_statement: $ => seq(
      'try',
      field('body', $.block),
      repeat(choice(
        $.catch_clause,
        alias($.preproc_if_in_catch_clause, $.preproc_if),
      )),
      optional($.finally_clause),
    ),

    catch_clause: $ => seq(
      'catch',
      repeat(choice($.catch_declaration, $.catch_filter_clause)),
      field('body', $.block),
    ),

    catch_declaration: $ => seq(
      '(',
      field('type', $.type),
      optional(field('name', $.identifier)),
      ')',
    ),

    catch_filter_clause: $ => seq('when', '(', $.expression, ')'),

    finally_clause: $ => seq('finally', $.block),

    unsafe_statement: $ => seq('unsafe', $.block),

    using_statement: $ => seq(
      optional('await'),
      'using',
      '(',
      choice(
        alias($.using_variable_declaration, $.variable_declaration),
        $.expression,
      ),
      ')',
      field('body', $.statement),
    ),

    foreach_statement: $ => seq(
      $._foreach_statement_initializer,
      field('body', $.statement),
    ),

    _foreach_statement_initializer: $ => seq(
      optional('await'),
      'foreach',
      '(',
      choice(
        seq(
          field('type', $.type),
          field('left', choice($.identifier, $.tuple_pattern)),
        ),
        field('left', $.expression),
      ),
      'in',
      field('right', $.expression),
      ')',
    ),

    goto_statement: $ => seq(
      'goto',
      optional(choice('case', 'default')),
      optional($.expression),
      ';',
    ),

    labeled_statement: $ => seq(
      $.identifier,
      ':',
      $.statement,
    ),

    if_statement: $ => prec.right(seq(
      'if',
      '(',
      // FORK: rule 14's mirror at a condition — see _expression_or_head.
      field('condition', $._expression_or_head),
      ')',
      field('consequence', $.statement),
      optional(seq(
        'else',
        field('alternative', $.statement),
      )),
    )),

    // FORK: rule 23 — see preproc_if_in_top_level.
    // Dynamic precedence -1 and a declared conflict with if_statement: inside a
    // branch `if (c) s1 else s2` fits both `if_statement` and `dangling_if`
    // followed by `s2`, and the one statement is the reading.
    dangling_if: $ => prec.dynamic(-1, seq(
      'if',
      '(',
      field('condition', $._expression_or_head),
      ')',
      field('consequence', $.statement),
      'else',
    )),

    // FORK: rule 16 — an `else` clause under `#if`. `if (a) {…}\n#if X\n else
    // if (b) {…}\n#endif\n else {…}`: forty-nine sites in three strata,
    // twenty-seven in one newtonsoft file. Upstream recovers it as an ERROR
    // whose extent the LR table decides — the tail of the method at one
    // regime, the whole namespace flattened at the next. An `else` the
    // preceding `if` did not take is an ORPHANED else clause: a statement of
    // its own, legal only where a statement is (so it stands inside a
    // statement-level `#if` and after its `#endif`), and `if_statement`'s
    // prec.right still takes a directly following `else` itself, so no
    // well-formed if/else changes. The extractor pairs each fragment with
    // the `if` it continues — the previous statement's, or, under a taken
    // branch, the else-less `if` inside the previous fragment.
    else_fragment: $ => prec.right(seq(
      'else',
      field('alternative', $.statement),
    )),

    while_statement: $ => seq(
      'while',
      '(',
      field('condition', $.expression),
      ')',
      field('body', $.statement),
    ),

    local_declaration_statement: $ => seq(
      optional('await'),
      optional('using'),
      repeat($._modifier),
      choice(
        seq($.variable_declaration, ';'),
        // FORK: rule 20 — see field_declaration.
        alias($._variable_declaration_with_tail, $.variable_declaration),
      ),
    ),

    local_function_statement: $ => seq(
      $._local_function_declaration,
      repeat($._constraints_clause_item),
      $._function_body,
    ),

    _local_function_declaration: $ => seq(
      repeat($._attribute_list),
      repeat($._modifier),
      field('type', $.type),
      field('name', $.identifier),
      field('type_parameters', optional($.type_parameter_list)),
      field('parameters', $.parameter_list),
    ),

    pattern: $ => choice(
      $.constant_pattern,
      $.declaration_pattern,
      $.discard,
      $.recursive_pattern,
      $.var_pattern,
      $.negated_pattern,
      // This must come before plain parenthesized_pattern to create GLR conflict
      prec.dynamic(1, alias($._parenthesized_pattern_with_designation, $.recursive_pattern)),
      $.parenthesized_pattern,
      $.relational_pattern,
      $.or_pattern,
      $.and_pattern,
      $.list_pattern,
      $.type_pattern,
    ),

    // Uses '(' pattern ')' to create direct conflict with parenthesized_pattern
    _parenthesized_pattern_with_designation: $ => seq(
      '(',
      $.pattern,
      ')',
      $._variable_designation,
    ),

    constant_pattern: $ => $._constant_pattern_operand,

    // FORK: the expressions a constant pattern — and a relational pattern's
    // operand — may be. Factored so the two cannot drift.
    _constant_pattern_operand: $ => choice(
      // FORK: arithmetic and shift only. With every operator allowed, `x is
      // null && P(x)` parsed as `x is (null && P(x))`, swallowing the right
      // operand of the logical expression into the pattern.
      alias($._constant_pattern_binary_expression, $.binary_expression),
      $.default_expression,
      $.interpolated_string_expression,
      $.parenthesized_expression,
      $.postfix_unary_expression,
      $.prefix_unary_expression,
      $.sizeof_expression,
      $.tuple_expression,
      $.typeof_expression,
      $.member_access_expression,
      alias($._name_invocation_pattern, $.invocation_expression),
      alias($._complex_invocation_expression, $.invocation_expression),
      $.cast_expression,
      $._simple_name,
      $.literal,
    ),

    _constant_pattern_binary_expression: $ => choice(
      ...[
        ['>>', PREC.SHIFT],
        ['>>>', PREC.SHIFT],
        ['<<', PREC.SHIFT],
        ['+', PREC.ADD],
        ['-', PREC.ADD],
        ['*', PREC.MULT],
        ['/', PREC.MULT],
        ['%', PREC.MULT],
      ].map(([operator, precedence]) =>
        prec.left(precedence, seq(
          field('left', $.expression),
          // @ts-ignore
          field('operator', operator),
          field('right', $.expression),
        )),
      ),
    ),

    // Invocation with name - creates conflict with recursive_pattern's Name(positional_pattern_clause)
    _name_invocation_pattern: $ => seq(
      field('function', $._name),
      field('arguments', $.argument_list),
    ),

    // Invocation where function is not a simple name
    _complex_invocation_expression: $ => prec(PREC.INVOCATION, seq(
      field('function', choice(
        $.member_access_expression,
        $.element_access_expression,
        $.invocation_expression,
        $.parenthesized_expression,
        $.conditional_access_expression,
        $.cast_expression,
      )),
      field('arguments', $.argument_list),
    )),

    discard: _ => '_',

    parenthesized_pattern: $ => seq('(', $.pattern, ')'),

    var_pattern: $ => seq('var', $._variable_designation),

    type_pattern: $ => prec.right(field('type', $.type)),

    list_pattern: $ => prec.right(seq(
      '[',
      optional(seq(
        commaSep1(choice($.pattern, $.slice_pattern)),
        optional(','),
      )),
      ']',
      optional($._variable_designation),
    )),

    // FORK: `[var head, .. var tail]` — a slice with a sub-pattern. Upstream
    // accepts only a bare `..`, so every slice that BINDS was a parse error
    // whose recovery could swallow the enclosing switch expression.
    slice_pattern: $ => prec.right(seq('..', optional($.pattern))),

    recursive_pattern: $ => prec.left(choice(
      // name followed by positional pattern WITH variable designation
      prec.dynamic(1, seq(
        field('type', $._name),
        $.positional_pattern_clause,
        optional($.property_pattern_clause),
        $._variable_designation,
      )),
      // name followed by positional pattern WITHOUT variable designation
      prec.dynamic(-1, seq(
        field('type', $._name),
        $.positional_pattern_clause,
        optional($.property_pattern_clause),
      )),
      // positional pattern with variable designation (no type prefix)
      prec.dynamic(1, seq(
        $.positional_pattern_clause,
        $._variable_designation,
      )),
      // positional pattern without variable designation (no type prefix)
      $.positional_pattern_clause,
      // other type followed by pattern clauses (type is required here to avoid ambiguity)
      seq(
        field('type', $.type),
        choice(
          seq(
            $.positional_pattern_clause,
            optional($.property_pattern_clause),
          ),
          $.property_pattern_clause,
        ),
        optional($._variable_designation),
      ),
      // no type, just pattern clauses (no variable designation to avoid conflict with above)
      seq(
        choice(
          seq(
            $.positional_pattern_clause,
            $.property_pattern_clause,
          ),
          $.property_pattern_clause,
        ),
        optional($._variable_designation),
      ),
    )),

    positional_pattern_clause: $ => prec(1, seq(
      '(',
      optional(commaSep($.subpattern)),
      ')',
    )),

    property_pattern_clause: $ => prec(1, seq(
      '{',
      commaSep($.subpattern),
      optional(','),
      '}',
    )),

    subpattern: $ => prec.right(seq(
      optional(
        choice(
          seq($.expression, ':'),
          seq($.identifier, ':'),
        ),
      ),
      $.pattern,
    )),

    // FORK: the operand is a CONSTANT expression, the same set a constant
    // pattern admits. With `$.expression` here, `x is < -1 ? a : b` parsed as
    // `x is < (-1 ? a : b)` — the conditional and both arms swallowed into the
    // pattern (CS-CORPUS-23). Roslyn parses the operand below `?:` and the
    // logical operators; so does this.
    relational_pattern: $ => choice(
      seq('<', $._constant_pattern_operand),
      seq('<=', $._constant_pattern_operand),
      seq('>', $._constant_pattern_operand),
      seq('>=', $._constant_pattern_operand),
    ),

    negated_pattern: $ => seq('not', $.pattern),

    and_pattern: $ => prec.left(PREC.AND, seq(
      field('left', $.pattern),
      field('operator', 'and'),
      field('right', $.pattern),
    )),

    or_pattern: $ => prec.left(PREC.OR, seq(
      field('left', $.pattern),
      field('operator', 'or'),
      field('right', $.pattern),
    )),

    declaration_pattern: $ => seq(
      field('type', $.type),
      $._variable_designation,
    ),

    _variable_designation: $ => prec(1, choice(
      $.discard,
      $.parenthesized_variable_designation,
      field('name', $.identifier),
    )),

    parenthesized_variable_designation: $ => seq(
      '(',
      commaSep($._variable_designation),
      ')',
    ),

    expression: $ => choice(
      $.non_lvalue_expression,
      $.lvalue_expression,
    ),

    non_lvalue_expression: $ => choice(
      'base',
      // FORK: rule 14 — a chain may END at its `#endif`; and the operator form.
      $.preproc_chain_expression,
      $.preproc_operator_expression,
      $.binary_expression,
      $.interpolated_string_expression,
      $.conditional_expression,
      // conditional_access_expression: an lvalue since fork23 (C# 14).
      $.literal,
      $._expression_statement_expression,
      $.is_expression,
      $.is_pattern_expression,
      $.as_expression,
      $.cast_expression,
      $.checked_expression,
      $.collection_expression,
      $.switch_expression,
      $.throw_expression,
      $.default_expression,
      $.lambda_expression,
      $.with_expression,
      $.sizeof_expression,
      $.typeof_expression,
      $.makeref_expression,
      $.ref_expression,
      $.reftype_expression,
      $.refvalue_expression,
      $.stackalloc_expression,
      $.range_expression,
      $.array_creation_expression,
      $.anonymous_method_expression,
      $.anonymous_object_creation_expression,
      $.implicit_array_creation_expression,
      $.implicit_object_creation_expression,
      $.implicit_stackalloc_expression,
      $.initializer_expression,
      $.query_expression,
      alias($.preproc_if_in_expression, $.preproc_if),
    ),

    lvalue_expression: $ => choice(
      'this',
      $.member_access_expression,
      $.tuple_expression,
      $._simple_name,
      $.element_access_expression,
      // FORK: a ref-returning call is a variable — `ById(o) = v` assigns
      // through the ref. Upstream had no way to put a call on the left, and
      // recovered `Local(x) = v` as a declaration of type `Local`.
      $.invocation_expression,
      // FORK (fork23): C# 14's null-conditional ASSIGNMENT — `x?[i] = v`,
      // `x?.P = v`, `t?.Tick -= h`. Twelve corpus files, four of them whole-file
      // ERRORs (ExpressionTreeFuncletizer.cs, 140 KB, among them). A parse gap
      // on the Roslyn side too under a C# 13 adjudicator, and stated as such.
      $.conditional_access_expression,
      alias($.bracketed_argument_list, $.element_binding_expression),
      alias($._pointer_indirection_expression, $.prefix_unary_expression),
      alias($._parenthesized_lvalue_expression, $.parenthesized_expression),
    ),

    // Covers error CS0201: Only assignment, call, increment, decrement, await, and new object expressions can be used as a statement
    _expression_statement_expression: $ => choice(
      $.assignment_expression,
      $.invocation_expression,
      $.postfix_unary_expression,
      $.prefix_unary_expression,
      $.await_expression,
      $.object_creation_expression,
      $.parenthesized_expression,
    ),

    assignment_expression: $ => seq(
      field('left', $.lvalue_expression),
      field('operator',
        choice(
          '=',
          '+=',
          '-=',
          '*=',
          '/=',
          '%=',
          '&=',
          '^=',
          '|=',
          '<<=',
          '>>=',
          '>>>=',
          '??=',
        ),
      ),
      // FORK: rule 14's mirror at an assignment's right — see _expression_or_head.
      field('right', $._expression_or_head),
    ),

    binary_expression: $ => choice(
      ...[
        ['&&', PREC.LOGICAL_AND],
        ['||', PREC.LOGICAL_OR],
        ['>>', PREC.SHIFT],
        ['>>>', PREC.SHIFT],
        ['<<', PREC.SHIFT],
        ['&', PREC.AND],
        ['^', PREC.XOR],
        ['|', PREC.OR],
        ['+', PREC.ADD],
        ['-', PREC.ADD],
        ['*', PREC.MULT],
        ['/', PREC.MULT],
        ['%', PREC.MULT],
        ['<', PREC.REL],
        ['<=', PREC.REL],
        ['==', PREC.EQUAL],
        ['!=', PREC.EQUAL],
        ['>=', PREC.REL],
        ['>', PREC.REL],
      ].map(([operator, precedence]) =>
        prec.left(precedence, seq(
          field('left', $.expression),
          // @ts-ignore
          field('operator', operator),
          // FORK: rule 14's mirror may stand only HERE — `a ||\n#if X\n b ||
          // \n#endif\n c` — never as a free-standing expression: admitted
          // everywhere, it gave error recovery a way to start an expression
          // at a statement-level `#if` and swallow the next method.
          field('right', choice($.expression, $.preproc_head_expression)),
        )),
      ),
      prec.right(PREC.COALESCING, seq(
        field('left', $.expression),
        field('operator', '??'),
        field('right', choice($.expression, $.preproc_head_expression)),
      )),
    ),

    postfix_unary_expression: $ => prec(PREC.POSTFIX, seq(
      $.expression,
      choice('++', '--', '!'),
    )),

    prefix_unary_expression: $ => prec(PREC.UNARY, seq(
      choice('++', '--', '+', '-', '!', '~', '&', '^'),
      $.expression,
    )),

    _pointer_indirection_expression: $ => prec.right(PREC.UNARY, seq(
      '*',
      // FORK: `*(T*)pointer` — the operand of `*` may be a cast, and unsafe
      // code writes it constantly (`_reference = ref *(T*)pointer;`). Upstream
      // took only an lvalue, the statement was an ERROR, and under the
      // primary-receiver rule that error's recovery swallowed two whole
      // files of one stratum.
      // FORK (fork20): and a PARENTHESIZED operand — `*(bytes++) = …`,
      // `*(pVal + 1)`, `*(*(void***)pUnk + 0)` — five BCL files whole-file
      // ERRORs for it (UnicodeEncoding, UTF32Encoding, InvariantModeCasing,
      // OrdinalCasing.Icu, Marshal).
      choice($.lvalue_expression, $.cast_expression, $.parenthesized_expression),
    )),

    query_expression: $ => seq($.from_clause, $._query_body),

    from_clause: $ => seq(
      'from',
      optional(field('type', $.type)),
      field('name', $.identifier),
      'in',
      $.expression,
    ),

    _query_body: $ => prec.right(sep1(
      seq(
        repeat($._query_clause),
        $._select_or_group_clause,
      ),
      seq('into', $.identifier),
    )),

    _query_clause: $ => choice(
      $.from_clause,
      $.join_clause,
      $.let_clause,
      $.order_by_clause,
      $.where_clause,
    ),

    join_clause: $ => seq(
      'join',
      $._join_header,
      $._join_body,
      optional($.join_into_clause),
    ),

    _join_header: $ => seq(optional(field('type', $.type)), $.identifier, 'in', $.expression),

    _join_body: $ => seq('on', $.expression, 'equals', $.expression),

    join_into_clause: $ => seq('into', $.identifier),

    let_clause: $ => seq(
      'let',
      $.identifier,
      '=',
      $.expression,
    ),

    order_by_clause: $ => seq(
      'orderby',
      commaSep1($._ordering),
    ),

    _ordering: $ => seq(
      $.expression,
      optional(choice('ascending', 'descending')),
    ),

    where_clause: $ => seq('where', $.expression),

    _select_or_group_clause: $ => choice(
      $.group_clause,
      $.select_clause,
    ),

    group_clause: $ => seq('group', $.expression, 'by', $.expression),

    select_clause: $ => seq('select', $.expression),

    conditional_expression: $ => prec.right(PREC.CONDITIONAL, seq(
      field('condition', $.expression),
      '?',
      field('consequence', $.expression),
      ':',
      field('alternative', $.expression),
    )),

    // FORK: rule 15 — `?.` binds to a PRIMARY expression, as `.` does (rule 9).
    // Upstream took any expression, at conditional precedence, so `a || b?.M()`
    // read as `(a || b)?.M()` and `!b?.M()` as `(!b)?.M()` — every binary or
    // prefix operand followed by a null-conditional chain, hundreds of sites.
    conditional_access_expression: $ => prec.right(PREC.CONDITIONAL, seq(
      field('condition', $._member_access_receiver),
      '?',
      choice(
        $.member_binding_expression,
        alias($.bracketed_argument_list, $.element_binding_expression),
      ),
    )),

    as_expression: $ => prec(PREC.REL, seq(
      field('left', $.expression),
      field('operator', 'as'),
      field('right', $.type),
    )),

    is_expression: $ => prec(PREC.REL, seq(
      field('left', $.expression),
      field('operator', 'is'),
      field('right', $.type),
    )),

    is_pattern_expression: $ => prec(PREC.REL, seq(
      field('expression', $.expression),
      'is',
      field('pattern', $.pattern),
    )),

    cast_expression: $ => prec(PREC.CAST, prec.dynamic(1, seq( // higher than invocation, lower than binary
      '(',
      field('type', $.type),
      ')',
      field('value', $.expression),
    ))),

    checked_expression: $ => seq(
      choice('checked', 'unchecked'),
      '(',
      $.expression,
      ')',
    ),

    invocation_expression: $ => prec(PREC.INVOCATION, seq(
      // FORK: the same receiver set as member access. `o is Point(var x, var y)`
      // read upstream as `(o is Point)(var x, var y)` — a call whose function
      // is an is-pattern expression — which no C# means without parentheses.
      field('function', choice(
        $._member_access_receiver,
        // FORK: C# §6.2.5 — a `<…>` followed by `(` is a type-argument list,
        // and the whole thing a generic CALL. `(T)Convert<T>(x)` also reads
        // as `((T)Convert) < T > (x)`, two comparisons; both readings hold
        // one cast, so they tied and the comparison won — 47 generic calls
        // lost on two strata, every cast-prefixed one (CS-CORPUS-26). The
        // generic-call reading earns a point, and two through a member.
        alias($._generic_call_name, $.generic_name),
        alias($._generic_call_member, $.member_access_expression),
      )),
      field('arguments', $.argument_list),
    )),

    _generic_call_name: $ => prec.dynamic(1, seq($.identifier, $.type_argument_list)),
    _generic_call_member: $ => prec.dynamic(1, prec(PREC.DOT, seq(
      field('expression', choice($._member_access_receiver, $.predefined_type, $._name)),
      choice('.', '->'),
      field('name', alias($._generic_call_name, $.generic_name)),
    ))),

    switch_expression: $ => prec(PREC.SWITCH, seq(
      $.expression,
      'switch',
      $._switch_expression_body,
    )),
    // FORK (fork20): rule 18's shape on switch-expression ARMS — `x switch {
    // A => a,\n#if X\n B => b,\n#endif\n _ => z }`. Twenty sites, sixteen in
    // Enum.cs (190 KB, a whole-file ERROR). A branch holds `arm ,` runs; the
    // arm after the `#endif` follows as any other.
    _switch_expression_body: $ => seq(
      '{',
      repeat(choice(
        seq($.switch_expression_arm, ','),
        alias($.preproc_if_in_switch_arm, $.preproc_if),
      )),
      optional($.switch_expression_arm),
      '}',
    ),
    switch_arm_fragment: $ => repeat1(seq($.switch_expression_arm, ',')),


    switch_expression_arm: $ => seq(
      $.pattern,
      optional($.when_clause),
      '=>',
      $.expression,
    ),

    when_clause: $ => seq('when', $.expression),

    await_expression: $ => prec.right(PREC.UNARY, seq(
      'await',
      $.expression,
    )),

    throw_expression: $ => seq('throw', $.expression),

    element_access_expression: $ => prec(PREC.POSTFIX, seq(
      // FORK: as for invocation — a postfix operator binds tighter than any
      // binary, conditional, `is` or `as`.
      field('expression', $._member_access_receiver),
      field('subscript', $.bracketed_argument_list),
    )),

    interpolated_string_expression: $ => choice(
      seq(
        alias($.interpolation_regular_start, $.interpolation_start),
        alias($.interpolation_start_quote, '"'),
        repeat($._interpolated_string_content),
        alias($.interpolation_end_quote, '"'),
      ),
      seq(
        alias($.interpolation_verbatim_start, $.interpolation_start),
        alias($.interpolation_start_quote, '"'),
        repeat($._interpolated_verbatim_string_content),
        alias($.interpolation_end_quote, '"'),
      ),
      seq(
        alias($.interpolation_raw_start, $.interpolation_start),
        alias($.interpolation_start_quote, $.interpolation_quote),
        repeat($._interpolated_raw_string_content),
        alias($.interpolation_end_quote, $.interpolation_quote),
      ),
    ),

    _interpolated_string_content: $ => choice(
      alias($.interpolation_string_content, $.string_content),
      $.escape_sequence,
      $.interpolation,
    ),

    _interpolated_verbatim_string_content: $ => choice(
      alias($.interpolation_string_content, $.string_content),
      $.interpolation,
    ),

    _interpolated_raw_string_content: $ => choice(
      alias($.interpolation_string_content, $.string_content),
      $.interpolation,
    ),

    interpolation: $ => seq(
      alias($.interpolation_open_brace, $.interpolation_brace),
      $.expression,
      optional($.interpolation_alignment_clause),
      optional($.interpolation_format_clause),
      alias($.interpolation_close_brace, $.interpolation_brace),
    ),

    interpolation_alignment_clause: $ => seq(',', $.expression),

    interpolation_format_clause: _ => seq(':', /[^}"]+/),

    member_access_expression: $ => prec(PREC.DOT, seq(
      field('expression', choice($._member_access_receiver, $.predefined_type, $._name)),
      choice('.', '->'),
      field('name', $._simple_name),
    )),

    // FORK: what `.` can bind to WITHOUT parentheses. `x is Limit.Max && Q(x)`
    // also read as `(x is Limit).Max && Q(x)` — a member access whose receiver
    // is an is-pattern expression — and the GLR fork declared for constant
    // patterns let that reading win. No C# reads it that way: `.` binds
    // tighter than `is`, `as` and every binary and conditional operator, so an
    // unparenthesised receiver is never one of those. Saying so in the grammar
    // removes the wrong reading instead of out-scoring it — the out-scoring
    // (one dynamic point per qualified segment inside a pattern) tipped the
    // recursive-pattern / invocation tie and turned `case nameof(X.Y):` into a
    // positional pattern (CS-CORPUS-28).
    // PRIMARY expressions only. A cast is NOT one: `(int?)Store(x)` is a cast
    // of the call, and with cast_expression admitted here it also read as a
    // call of the cast — `((int?)Store)(x)` — and the cast's dynamic point
    // tied both readings. Nor is `await x`, `-x`, `a = b`, a switch, a with,
    // a query, a lambda or a throw: each binds looser than `.`.
    _member_access_receiver: $ => choice(
      $.lvalue_expression,
      $.parenthesized_expression,
      'base',
      $.literal,
      $.interpolated_string_expression,
      $.conditional_access_expression,
      $.object_creation_expression,
      $.anonymous_object_creation_expression,
      $.array_creation_expression,
      $.implicit_array_creation_expression,
      $.implicit_object_creation_expression,
      // `stackalloc byte[n].Slice(0, len)` is written and compiles; four files
      // in one stratum got a MISSING `!` without these two.
      $.stackalloc_expression,
      $.implicit_stackalloc_expression,
      $.checked_expression,
      $.default_expression,
      $.sizeof_expression,
      $.typeof_expression,
      $.makeref_expression,
      $.reftype_expression,
      $.refvalue_expression,
      $.postfix_unary_expression,
      alias($.preproc_if_in_expression, $.preproc_if),
      // FORK: rule 14 — a `#if` splitting a fluent chain.
      $.preproc_chain_expression,
    ),

    // FORK: rule 14. `x\n#if A\n .M(a)\n#else\n .N(b)\n#endif\n .P()` —
    // a preprocessor branch holding CHAIN SEGMENTS, receiver-less, exactly the
    // shape `?.` gives a `member_binding_expression`. Upstream recovers it as
    // a coherent misparse: the receiver `x` becomes an ERROR sibling and the
    // `#if` — legal as a RECEIVER through preproc_if_in_expression — holds
    // `(ERROR) (invocation M(a))`, a call with no receiver. 24 sites in 14
    // files across nine strata, every MAUI and minimal-API builder chain
    // among them (CS-CORPUS-30). The node keeps its receiver in `expression`
    // and the branches under a `preproc_if`; each branch is one chain whose
    // innermost node is a binding, and the extractor grafts the receiver
    // onto it.
    preproc_chain_expression: $ => prec(PREC.DOT, seq(
      field('expression', $._member_access_receiver),
      alias($.preproc_if_in_chain, $.preproc_if),
    )),

    // FORK: rule 14, the OPERATOR form — `a\n#if X\n || b\n#endif`: the
    // operator and its right operand are inside the branch. Thirteen sites in
    // three strata, every one a `&&`/`||` continuation of a condition. The
    // left operand is a full expression at COALESCING precedence — below every
    // binary operator — so `c == '&' || c > 159\n#if\n || c == '\\''` takes
    // the whole disjunction as its left, not `159`. C#'s binary operators are
    // left-associative, so an operator AFTER the `#endif` at the same
    // precedence — `(a && x) && y` — is the tree the compiler builds too. An
    // operator after `#endif` that binds TIGHTER than the one inside would
    // associate differently; no corpus site has one, and the fixture says so.
    preproc_operator_expression: $ => prec.left(PREC.COALESCING, seq(
      field('left', $.expression),
      alias($.preproc_if_in_operator_tail, $.preproc_if),
    )),
    // FORK: rule 14's mirror — the branch ENDS with the operator:
    // `a ||\n#if X\n b ||\n#endif\n c`. Thirty-five sites, twenty-nine in the
    // BCL stratum. An ERROR at every regime, and one whose recovery the LR
    // table's shape decides: rule 15 moved it from method-local to whole-file
    // in one file. The head is `expression operator`, the rest follows.
    preproc_head_expression: $ => prec.right(PREC.COALESCING, seq(
      alias($.preproc_if_in_operator_head, $.preproc_if),
      // Heads CHAIN: `a ||\n#if X\n b ||\n#endif\n#if Y\n c ||\n#endif\n d`
      // (JsonPropertyInfo.cs) — the right of one head is the next head.
      field('right', $._expression_or_head),
    )),
    // FORK: rule 14's mirror also STARTS an expression — `return\n#if X\n a &&
    // \n#endif\n b;`, `x =\n#if X\n F() ??\n#endif\n y;`, `if (\n#if X\n !a &&
    // \n#endif\n b)` — fifteen corpus sites at four positions. Admitted only at
    // those positions, never as a free-standing expression: admitted
    // everywhere, it gave error recovery a way to start an expression at a
    // statement-level `#if` and swallow the next method.
    _expression_or_head: $ => choice($.expression, $.preproc_head_expression),
    operator_head: $ => seq(
      field('left', $.expression),
      field('operator', choice(
        '+', '-', '*', '/', '%', '&&', '||', '??', '|', '&', '^',
        '==', '!=', '<', '>', '<=', '>=', '<<', '>>', '>>>',
      )),
    ),

    operator_tail: $ => seq(
      field('operator', choice(
        '+', '-', '*', '/', '%', '&&', '||', '??', '|', '&', '^',
        '==', '!=', '<', '>', '<=', '>=', '<<', '>>', '>>>',
      )),
      field('right', $.expression),
    ),

    _chain_expression: $ => choice(
      $.member_binding_expression,
      alias($._chain_invocation, $.invocation_expression),
      alias($._chain_member_access, $.member_access_expression),
      alias($._chain_element_access, $.element_access_expression),
    ),
    _chain_invocation: $ => prec(PREC.INVOCATION, seq(
      field('function', $._chain_expression),
      field('arguments', $.argument_list),
    )),
    _chain_member_access: $ => prec(PREC.DOT, seq(
      field('expression', $._chain_expression),
      '.',
      field('name', $._simple_name),
    )),
    _chain_element_access: $ => prec(PREC.POSTFIX, seq(
      field('expression', $._chain_expression),
      field('subscript', $.bracketed_argument_list),
    )),

    member_binding_expression: $ => seq(
      '.',
      field('name', $._simple_name),
    ),

    object_creation_expression: $ => prec.right(seq(
      'new',
      // FORK: `new Foo<T>(x) { … }`. With the initializer present the tokens
      // also read as `new Foo < T > (x){ … }` — two comparisons and a CAST of
      // the initializer — and cast_expression carries a dynamic point that
      // made that reading win. Without the initializer the creation parsed
      // fine, so `new List<int>(n) { 1, 2 }` was the one shape of four that
      // came out as arithmetic (CS-CORPUS-22). A generic type read directly
      // under `new` earns two points, so the creation wins the tie.
      field('type', choice(
        $.type,
        alias($._object_creation_generic_type, $.generic_name),
        alias($._object_creation_qualified_generic_type, $.qualified_name),
      )),
      field('arguments', optional($.argument_list)),
      field('initializer', optional($.initializer_expression)),
    )),

    _object_creation_generic_type: $ => prec.dynamic(2, seq($.identifier, $.type_argument_list)),
    // `new A.B<T>(x) { … }` and `new Outer<T>.Nested(x)`: a QUALIFIED type
    // under `new`, with a generic on any segment, earns three — one more than
    // the simple generic, because `new Outer<T>.Nested(1)` also reads as
    // `(new Outer<T>).Nested(1)`, a member call on a creation, and that
    // reading holds the simple generic's two (CS-CORPUS-27: nine creations
    // emitted as calls).
    _object_creation_qualified_generic_type: $ => prec.dynamic(3, prec(PREC.DOT, seq(
      // A generic FIRST segment goes through the scored rule as well, or the
      // static preference below hands `Outer<T>` to the simple-generic reading
      // before the qualifier can claim it.
      field('qualifier', choice(
        $._name,
        alias($._object_creation_generic_type, $.generic_name),
        // and the rule itself, so `new Outer<T>.Inner.Nested(1)` scores one
        // segment deeper than `(new Outer<T>.Inner).Nested(1)` at any depth.
        alias($._object_creation_qualified_generic_type, $.qualified_name),
      )),
      '.',
      // The last segment's generic goes through the scored rule too: at `B <`
      // the parser must fork between a type-argument list and a comparison,
      // and only the scored rule sits in the conflict declared for that.
      field('name', choice(
        // The plain segment yields to the generic one at `<`: reducing the
        // identifier and reading `< T >` as comparisons was the static choice
        // without these precedences.
        prec(-1, $.identifier),
        alias(prec(PREC.DOT + 1, $._object_creation_generic_type), $.generic_name),
      )),
    ))),

    // inline
    _object_creation_type: $ => choice(
      $._name,
      $.nullable_type,
      $.predefined_type,
    ),

    parenthesized_expression: $ => seq(
      '(',
      $.non_lvalue_expression,
      ')',
    ),

    _parenthesized_lvalue_expression: $ => seq('(', $.lvalue_expression, ')'),

    lambda_expression: $ => prec(-1, seq(
      $._lambda_expression_init,
      '=>',
      field('body', choice($.block, $.expression)),
    )),

    _lambda_expression_init: $ => prec(-1, seq(
      repeat($._attribute_list),
      repeat($._anonymous_function_modifier),
      optional(field('type', $.type)),
      field('parameters', $._lambda_parameters),
    ),
    ),

    // FORK: `async` is a reserved identifier (the async patch), so a lambda's
    // `async` read as its return TYPE — `async (x) => …` became a lambda of
    // type `async`, and `async Task (x) => …` an error at `Task`. In lambda
    // position C# reads `async` as the modifier; the modifier reading earns a
    // point so it wins the tie. Shared with anonymous methods, whose prefix
    // is the same tokens.
    _anonymous_function_modifier: $ => choice(
      prec(-1, alias('static', $.modifier)),
      prec.dynamic(1, alias('async', $.modifier)),
    ),

    _lambda_parameters: $ => prec(-1, choice(
      $.parameter_list,
      alias($.identifier, $.implicit_parameter),
    )),

    array_creation_expression: $ => prec.dynamic(PREC.UNARY, seq(
      'new',
      field('type', $.array_type),
      optional($.initializer_expression),
    )),

    anonymous_method_expression: $ => seq(
      repeat($._anonymous_function_modifier),
      'delegate',
      optional(field('parameters', $.parameter_list)),
      $.block,
    ),

    anonymous_object_creation_expression: $ => seq(
      'new',
      '{',
      commaSep($._anonymous_object_member_declarator),
      optional(','),
      '}',
    ),

    _anonymous_object_member_declarator: $ => choice(
      seq($.identifier, '=', $.expression),
      $.expression,
    ),

    implicit_array_creation_expression: $ => seq(
      'new',
      '[',
      repeat(','),
      ']',
      $.initializer_expression,
    ),

    implicit_object_creation_expression: $ => prec.right(seq(
      'new',
      $.argument_list,
      optional($.initializer_expression),
    )),

    implicit_stackalloc_expression: $ => seq(
      'stackalloc',
      '[',
      ']',
      $.initializer_expression,
    ),

    collection_expression: $ => seq(
      '[',
      optional(seq(
        commaSep1($.collection_element),
        optional(','),
      )),
      ']',
    ),

    collection_element: $ => choice(
      $.expression_element,
      $.spread_element,
    ),

    expression_element: $ => prec(1, $.expression),

    spread_element: $ => prec.dynamic(1, prec(PREC.RANGE, seq('..', $.expression))),

    // FORK: rule 38 (fork26) — a `#if` inside a COLLECTION or OBJECT INITIALIZER
    // whose branch holds `element,` runs. Rule 18's shape (`argument_fragment`)
    // one container over:
    //
    //     new List<Func<Type,bool>>()
    //     {
    //         t => t.FullName.StartsWith("System."),
    //     #if !UNBOUND_GENERICS_GETCONSTRUCTORS
    //         t => t.IsGenericTypeDefinition(),
    //     #endif
    //         t => t.GetConstructors().Length == 0,
    //     };
    //
    // Upstream leaves the branch's closing token an ERROR and the elements
    // after the `#endif` go with it.
    // Shaped like `argument_list`, and for the same reason: the branch carries
    // its OWN trailing comma, so a `commaSep` over `expression | #if` wants a
    // comma AFTER the #if that the source does not have. `element ,` pairs
    // repeat, the #if stands where such a pair stands, and a last element
    // without a comma closes the list.
    initializer_expression: $ => seq(
      '{',
      repeat(choice(
        seq($.expression, ','),
        alias($.preproc_if_in_initializer, $.preproc_if),
      )),
      optional($.expression),
      '}',
    ),

    declaration_expression: $ => prec.dynamic(1, seq(
      field('type', $.type),
      field('name', $.identifier),
    )),

    default_expression: $ => prec.right(seq(
      'default',
      optional(seq(
        '(',
        field('type', $.type),
        ')',
      )),
    )),

    with_expression: $ => prec.left(PREC.WITH, seq(
      $.expression,
      'with',
      $._with_body,
    )),
    _with_body: $ => seq(
      '{',
      commaSep($.with_initializer),
      optional(','),
      '}',
    ),

    with_initializer: $ => seq($.identifier, '=', $.expression),

    sizeof_expression: $ => seq(
      'sizeof',
      '(',
      field('type', $.type),
      ')',
    ),

    typeof_expression: $ => seq(
      'typeof',
      '(',
      field('type', $.type),
      ')',
    ),

    makeref_expression: $ => seq(
      '__makeref',
      '(',
      $.expression,
      ')',
    ),

    ref_expression: $ => seq('ref', $.expression),

    reftype_expression: $ => seq(
      '__reftype',
      '(',
      $.expression,
      ')',
    ),

    refvalue_expression: $ => seq(
      '__refvalue',
      '(',
      field('value', $.expression),
      ',',
      field('type', $.type),
      ')',
    ),

    stackalloc_expression: $ => prec.left(seq(
      'stackalloc',
      field('type', $.array_type),
      optional($.initializer_expression),
    )),

    range_expression: $ => prec.right(PREC.RANGE, seq(
      optional($.expression),
      '..',
      optional($.expression),
    )),

    tuple_expression: $ => seq(
      '(',
      commaSep2($.argument),
      ')',
    ),

    literal: $ => choice(
      $.null_literal,
      $.character_literal,
      $.integer_literal,
      $.real_literal,
      $.boolean_literal,
      $.string_literal,
      $.verbatim_string_literal,
      $.raw_string_literal,
    ),

    null_literal: _ => 'null',

    character_literal: $ => seq(
      '\'',
      choice($.character_literal_content, $.escape_sequence),
      '\'',
    ),

    character_literal_content: $ => token.immediate(/[^'\\]/),

    integer_literal: _ => token(seq(
      choice(
        decimalDigitSequence, // Decimal
        (/0[xX][0-9a-fA-F_]*[0-9a-fA-F]+/), // Hex
        (/0[bB][01_]*[01]+/), // Binary
      ),
      optional(/([uU][lL]?|[lL][uU]?)/),
    )),

    real_literal: _ => {
      const suffix = /[fFdDmM]/;
      const exponent = /[eE][+-]?[0-9][0-9_]*/;
      return token(choice(
        seq(
          decimalDigitSequence,
          '.',
          decimalDigitSequence,
          optional(exponent),
          optional(suffix),
        ),
        seq(
          '.',
          decimalDigitSequence,
          optional(exponent),
          optional(suffix),
        ),
        seq(
          decimalDigitSequence,
          exponent,
          optional(suffix),
        ),
        seq(
          decimalDigitSequence,
          suffix,
        ),
      ));
    },

    string_literal: $ => seq(
      '"',
      repeat(choice(
        $.string_literal_content,
        $.escape_sequence,
      )),
      '"',
      optional($.string_literal_encoding),
    ),

    string_literal_content: _ => token.immediate(prec(1, /[^"\\\n]+/)),

    escape_sequence: _ => token(choice(
      /\\x[0-9a-fA-F]{1,4}/,
      /\\u[0-9a-fA-F]{4}/,
      /\\U[0-9a-fA-F]{8}/,
      /\\[abefnrtv'\"\\\?0]/,
    )),

    string_literal_encoding: _ => token.immediate(stringEncoding),

    verbatim_string_literal: _ => token(seq(
      '@"',
      repeat(choice(
        /[^"]/,
        '""',
      )),
      '"',
      optional(stringEncoding),
    )),

    raw_string_literal: $ => seq(
      $.raw_string_start,
      $.raw_string_content,
      $.raw_string_end,
      optional(stringEncoding),
    ),

    boolean_literal: _ => choice('true', 'false'),

    _identifier_token: _ => token(seq(optional('@'), /(\p{XID_Start}|_|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})(\p{XID_Continue}|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})*/)),
    identifier: $ => choice(
      $._identifier_token,
      $._reserved_identifier,
    ),

    _reserved_identifier: _ => choice(
      'alias',
      'allows',
      // FORK (fork25): `extension` introduces a C# 14 extension block and is
      // otherwise an ordinary name — 424 corpus files use the word, and making
      // it a keyword proper would break every one of them.
      'extension',
      // FORK (fork21): the attribute targets `property`, `type`, `typevar`,
      // `method` and `param` are contextual — `[property]` and `[type]` are
      // collection EXPRESSIONS whose one element is a local so named, and
      // upstream read the word as the target of an attribute list: 19 efcore
      // sites, `AddKey([property])`. `field` was already here; `event` and
      // `return` are keywords proper.
      'method',
      'param',
      'property',
      'type',
      'typevar',
      'ascending',
      'async',
      'by',
      'descending',
      'equals',
      'file',
      'from',
      'global',
      'group',
      'into',
      'join',
      'let',
      'notnull',
      'on',
      'orderby',
      'scoped',
      'select',
      'unmanaged',
      'var',
      'when',
      'where',
      'yield',
    ),

    // Preprocessor

    ...preprocIf('', $ => $.declaration),
    // FORK: rule 23 — `#if X\n if (c) { … }\n else\n#endif\n { body }`: an if
    // whose `else` keyword is the last token of the branch and whose else body
    // follows the `#endif` — under the taken branch the body is the else's,
    // under the untaken one it is a block of its own. Seventeen sites, all
    // newtonsoft. The dangling if is an `if_statement` with no alternative;
    // the block after the `#endif` is a statement like any other.
    ...preprocIf('_in_top_level', $ => choice(
      $._top_level_item_no_statement,
      $.statement,
      alias($.dangling_if, $.if_statement),
    )),
    ...preprocIf('_in_expression', $ => $.expression, -2, false),
    // FORK: rule 14 — see preproc_chain_expression.
    ...preprocIf('_in_chain', $ => $._chain_expression, 0, false, true),
    ...preprocIf('_in_operator_tail', $ => $.operator_tail, 0, false, true),
    ...preprocIf('_in_operator_head', $ => $.operator_head, 0, false, true),
    // FORK: rules 17 and 18 — see parameter_list and argument_list.
    ...preprocIf('_in_parameter', $ => $.parameter_fragment, 0, false, true),
    ...preprocIf('_in_argument', $ => $.argument_fragment, 0, false, true),
    ...preprocIf('_in_argument_close', $ => $.argument_close_fragment, 0, false, true),
    ...preprocIf('_in_enum_member_declaration', $ => $.enum_member_declaration, 0, false),
    // FORK (fork22): a branch may hold SEVERAL attribute lists —
    // `#if X\n [Obsolete(…)]\n [EditorBrowsable(…)]\n#endif\n public static …`
    // (StreamExtensions.cs, eight sites).
    ...preprocIf('_in_attribute_list', $ => $.attribute_list, -1, true),
    // FORK (fork22) — see _modifier.
    ...preprocIf('_in_modifier', $ => repeat1($.modifier), 0, false, true),
    // FORK (fork22) — see method_declaration's `returns`.
    ...preprocIf('_in_return_type', $ => $.type, 0, false, true),
    // FORK (fork23, rule 32) — see class_declaration.
    ...preprocIf('_in_class_header', $ => $.class_header, 0, false, true),
    ...preprocIf('_in_method_header', $ => $.method_header, 0, false, true),
    ...preprocIf('_in_constructor_header', $ => $.constructor_header, 0, false, true),
    // FORK (fork23) — see type_parameter_constraints_clause.
    ...preprocIf('_in_constraint_continuation', $ => $.constraint_continuation, 0, false, true),
    ...preprocIf('_in_base_list', $ => $.base_list, 0, false),
    // FORK: rule 22 — see base_list.
    ...preprocIf('_in_base_continuation', $ => $.base_continuation, 0, false, true),
    ...preprocIf('_in_base_fragment', $ => $.base_fragment, 0, false, true),
    ...preprocIf('_in_record_base', $ => alias($.record_base, $.base_list), 0, false),
    ...preprocIf('_in_function_body', $ => choice(
      $.block,
      seq($.arrow_expression_clause, ';'),
      // FORK: `M()\n#if X\n { … }\n#else\n ;\n#endif` — a default interface
      // body against an abstract one (ILogger.cs, eight sites).
      ';',
    ), 0, false),
    // FORK: rule 38 (fork26) — see initializer_expression. The branch holds one
    // or more `element ,` pairs, comma INCLUDED, exactly as rule 18's argument
    // fragment does; required, so an empty branch cannot let recovery close the
    // #if with a MISSING #endif.
    ...preprocIf('_in_initializer', $ => $.initializer_fragment, 0, false, true),
    // FORK: rule 39 (fork26) — see try_statement.
    ...preprocIf('_in_catch_clause', $ => $.catch_clause, 0, true),
    // FORK: rule 36 (fork24) — see _function_body. The branch holds the whole
    // arrow clause and NOTHING else: `required` rather than optional, because
    // an empty branch would let recovery close the #if with a MISSING #endif
    // and read the `;` as the body of a #if that swallowed the next member —
    // the failure rule 14 already paid for.
    ...preprocIf('_in_arrow_body', $ => $.arrow_expression_clause, 0, false, true),
    // FORK: rules 19 and 20 — a branch holding `expression ;`, no wrapper node.
    ...preprocIf('_in_expression_tail', $ => seq($.expression, ';'), 0, false, true),
    // FORK: rule 21 — see switch_body.
    ...preprocIf('_in_switch_section', $ => $.switch_section, 0, true),
    ...preprocIf('_in_switch_label', $ => $.switch_label, 1, true),
    // FORK (fork20) — see _switch_expression_body.
    ...preprocIf('_in_switch_arm', $ => $.switch_arm_fragment, 0, false, true),
    // FORK (fork20) — see _constraints_clause_item.
    ...preprocIf('_in_constraints_clause', $ => repeat1($.type_parameter_constraints_clause), 0, false, true),
    ...preprocIf('_in_property_body', $ => choice(
      seq($.accessor_list, optional(seq('=', $.expression, ';'))),
      seq($.arrow_expression_clause, ';'),
    ), 0, false),

    preproc_arg: _ => token(prec(-1, /\S([^/\n]|\/[^*]|\\\r?\n)*/)),
    preproc_directive: _ => /#[ \t]*[a-zA-Z0-9]\w*/,

    _preproc_expression: $ => choice(
      $.identifier,
      $.boolean_literal,
      $.integer_literal,
      $.character_literal,
      alias($.preproc_unary_expression, $.unary_expression),
      alias($.preproc_binary_expression, $.binary_expression),
      alias($.preproc_parenthesized_expression, $.parenthesized_expression),
    ),

    preproc_parenthesized_expression: $ => seq(
      '(',
      $._preproc_expression,
      ')',
    ),

    preproc_unary_expression: $ => prec.left(PREC.UNARY, seq(
      field('operator', '!'),
      field('argument', $._preproc_expression),
    )),

    preproc_binary_expression: $ => {
      const table = [
        ['||', PREC.LOGICAL_OR],
        ['&&', PREC.LOGICAL_AND],
        ['==', PREC.EQUAL],
        ['!=', PREC.EQUAL],
      ];

      return choice(...table.map(([operator, precedence]) => {
        return prec.left(precedence, seq(
          field('left', $._preproc_expression),
          // @ts-ignore
          field('operator', operator),
          field('right', $._preproc_expression),
        ));
      }));
    },

    preproc_region: $ => seq(
      preprocessor('region'),
      optional(field('content', $.preproc_arg)),
      /\n/,
    ),

    preproc_endregion: $ => seq(
      preprocessor('endregion'),
      optional(field('content', $.preproc_arg)),
      /\n/,
    ),

    preproc_line: $ => seq(
      preprocessor('line'),
      choice(
        'default',
        'hidden',
        seq($.integer_literal, optional($.string_literal)),
        seq(
          '(', $.integer_literal, ',', $.integer_literal, ')',
          '-',
          '(', $.integer_literal, ',', $.integer_literal, ')',
          optional($.integer_literal),
          $.string_literal,
        ),
      ),
      /\n/,
    ),

    preproc_pragma: $ => seq(
      preprocessor('pragma'),
      choice(
        seq('warning',
          choice('disable', 'restore'),
          commaSep(
            choice(
              $.identifier,
              $.integer_literal,
            ))),
        seq('checksum', $.string_literal, $.string_literal, $.string_literal),
      ),
      // FORK: a `#pragma` as the LAST LINE of a file with no trailing newline
      // — 36 newtonsoft test files end `#pragma warning restore 618` at EOF.
      // The root reported an error with no ERROR node, no MISSING node and no
      // zero-width node anywhere: cs_parse_gap's SELF_REPORTING_NODE class.
      // The newline is what ends the id list, so the terminator stays; it is
      // an EXTERNAL token that is a newline or end of file, because only the
      // scanner can see EOF.
      $._pragma_end,
    ),

    preproc_nullable: _ => seq(
      preprocessor('nullable'),
      choice('enable', 'disable', 'restore'),
      optional(choice('annotations', 'warnings')),
      /\n/,
    ),

    // FORK: `#error` and `#warning` with NO message — `#else\n    #error\n#endif`
    // in RuntimeInformation.Browser.cs, a MISSING `#endif` from the required
    // argument.
    preproc_error: $ => seq(
      preprocessor('error'),
      optional($.preproc_arg),
      /\n/,
    ),

    preproc_warning: $ => seq(
      preprocessor('warning'),
      optional($.preproc_arg),
      /\n/,
    ),

    preproc_define: $ => seq(
      preprocessor('define'),
      $.preproc_arg,
      /\n/,
    ),

    preproc_undef: $ => seq(
      preprocessor('undef'),
      $.preproc_arg,
      /\n/,
    ),

    shebang_directive: _ => token(seq('#!', /.*/)),

    comment: _ => token(choice(
      seq('//', /[^\n\r]*/),
      seq(
        '/*',
        /[^*]*\*+([^/*][^*]*\*+)*/,
        '/',
      ),
    )),
  },
});

/**
 * Creates a preprocessor regex rule
 *
 * @param {RegExp | Rule | string} command
 *
 * @returns {AliasRule}
 */
function preprocessor(command) {
  return alias(new RegExp('#[ \t]*' + command), '#' + command);
}

/**
 *
 * @param {string} suffix
 *
 * @param {RuleBuilder<string>} content
 *
 * @param {number} precedence
 *
 * @param {boolean} rep
 *
 * @returns {RuleBuilders<string, string>}
 */
function preprocIf(suffix, content, precedence = 0, rep = true, required = false) {
  /**
   *
   * @param {GrammarSymbols<string>} $
   *
   * @returns {ChoiceRule}
   */
  function alternativeBlock($) {
    return choice(
      suffix ? alias($['preproc_else' + suffix], $.preproc_else) : $.preproc_else,
      suffix ? alias($['preproc_elif' + suffix], $.preproc_elif) : $.preproc_elif,
    );
  }

  // FORK: `required` — exactly one content, never none. A chain branch
  // (rule 14) must hold a segment: with the content optional, error recovery
  // closed `a\n#if X\n + b` with a MISSING #endif, left an EMPTY chain, and
  // read `+ b` and the other arm's `- b` as two binary operands — both
  // branches in one tree, which no emission may contain.
  const body = $ => rep ? repeat(content($)) : required ? content($) : optional(content($));

  return {
    ['preproc_if' + suffix]: $ => prec(precedence, seq(
      preprocessor('if'),
      field('condition', $._preproc_expression),
      /\n/,
      body($),
      field('alternative', optional(alternativeBlock($))),
      preprocessor('endif'),
    )),

    ['preproc_else' + suffix]: $ => prec(precedence, seq(
      preprocessor('else'),
      body($),
    )),

    ['preproc_elif' + suffix]: $ => prec(precedence, seq(
      preprocessor('elif'),
      field('condition', $._preproc_expression),
      /\n/,
      body($),
      field('alternative', optional(alternativeBlock($))),
    )),
  };
}

/**
 * Creates a rule to match one or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @returns {SeqRule}
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

/**
 * Creates a rule to match two or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @returns {SeqRule}
 */
function commaSep2(rule) {
  return seq(rule, repeat1(seq(',', rule)));
}

/**
 * Creates a rule to optionally match one or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @returns {ChoiceRule}
 */
function commaSep(rule) {
  return optional(commaSep1(rule));
}

/**
 * Creates a rule to match one or more of the rules separated by `separator`
 *
 * @param {RuleOrLiteral} rule
 *
 * @param {RuleOrLiteral} separator
 *
 * @returns {SeqRule}
 */
function sep1(rule, separator) {
  return seq(rule, repeat(seq(separator, rule)));
}

/**
 * Creates a rule to optionally match one or more of the rules separated by `separator`
 *
 * @param {RuleOrLiteral} rule
 *
 * @param {RuleOrLiteral} separator
 *
 * @returns {ChoiceRule}
 */
function sep(rule, separator) {
  return optional(sep1(rule, separator));
}
