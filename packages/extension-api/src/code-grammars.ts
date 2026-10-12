export type Family = {
	pattern: RegExp;
	keywords: ReadonlySet<string>;
	types: ReadonlySet<string>;
	foldCase?: boolean;
	capitalisedIsType?: boolean;
};

export type FamilyLanguage =
	| 'typescript'
	| 'rust'
	| 'python'
	| 'shell'
	| 'json'
	| 'go'
	| 'sql'
	| 'yaml'
	| 'toml'
	| 'css'
	| 'markdown'
	| 'c'
	| 'csharp'
	| 'java'
	| 'kotlin'
	| 'swift'
	| 'php'
	| 'ruby'
	| 'lua'
	| 'dockerfile'
	| 'makefile'
	| 'ini'
	| 'graphql'
	| 'generic';

function wordSet(words: string): ReadonlySet<string> {
	return new Set(words.split(' '));
}

const NO_WORDS: ReadonlySet<string> = new Set();

const SLASH_COMMENTS = String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/|\/\*[\s\S]*`;
const C_NUMBER = String.raw`\b0[xXbB][\da-fA-F_']+[uUlL]*\b|\b\d[\d_']*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?[uUlLfFdDmM]*\b`;
const C_PUNCTUATION = String.raw`[{}()[\].,;:?!<>=+\-*\/%&|^~]+`;

function pattern(source: string, flags = 'g'): RegExp {
	return new RegExp(source, flags);
}

const JVM_PATTERN = pattern(
	String.raw`(?<comment>${SLASH_COMMENTS})|(?<string>"""[\s\S]*?"""|"""[\s\S]*|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?)|(?<attr>@[A-Za-z_][\w.]*|#[A-Za-z_]\w*)|(?<number>${C_NUMBER})|(?<ident>[A-Za-z_$][\w$]*)|(?<punct>${C_PUNCTUATION})`,
);

export const FAMILIES: Readonly<Record<FamilyLanguage, Family>> = {
	typescript: {
		pattern:
			/(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/|\/\*[\s\S]*)|(?<string>"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?)|(?<regex>\/(?<=(?:^|[=(,:;[!&|?{}]|\breturn|\btypeof)[ \t]*\/)(?![/*])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuvy]*)|(?<number>\b0[xXbBoO][\da-fA-F_]+n?\b|\b\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?\b)|(?<attr>@[A-Za-z_$][\w$]*)|(?<ident>[A-Za-z_$][\w$]*)|(?<punct>[{}()[\].,;:?!<>=+\-*\/%&|^~]+)/gm,
		keywords: wordSet(
			'const let var function class extends implements interface type enum return if else for while do switch case default break continue new delete typeof instanceof in of this super import export from as async await yield try catch finally throw static get set public private protected readonly abstract declare namespace module satisfies keyof infer is void null undefined true false',
		),
		types: wordSet(
			'string number boolean any unknown never object symbol bigint Promise Array Record Map Set Partial Required Readonly Pick Omit',
		),
		capitalisedIsType: true,
	},
	rust: {
		pattern:
			/(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/|\/\*[\s\S]*)|(?<string>r#*"[\s\S]*?"#*|b?"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])')|(?<attr>#!?\[[^\]\n]*\]?)|(?<number>\b0[xXbBoO][\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d[\d_]*)?(?:[iuf](?:8|16|32|64|128|size))?\b)|(?<lifetime>'[A-Za-z_]\w*)|(?<ident>[A-Za-z_]\w*!?)|(?<punct>[{}()[\].,;:?<>=+\-*\/%&|^~!]+)/g,
		keywords: wordSet(
			'fn let mut const static struct enum trait impl for while loop match if else return break continue use mod pub crate self Self super where as in ref move dyn unsafe async await type extern box true false',
		),
		types: wordSet(
			'u8 u16 u32 u64 u128 usize i8 i16 i32 i64 i128 isize f32 f64 bool char str String Vec Option Result Box Rc Arc HashMap HashSet',
		),
		capitalisedIsType: true,
	},
	python: {
		pattern:
			/(?<comment>#[^\n]*)|(?<string>[rbfuRBFU]{0,2}(?:"""[\s\S]*?"""|"""[\s\S]*|'''[\s\S]*?'''|'''[\s\S]*|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?))|(?<attr>@[A-Za-z_][\w.]*)|(?<number>\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?[jJ]?\b)|(?<ident>[A-Za-z_]\w*)|(?<punct>[{}()[\].,;:?<>=+\-*\/%&|^~!]+)/g,
		keywords: wordSet(
			'def class return if elif else for while break continue pass import from as with try except finally raise lambda yield global nonlocal assert del in is not and or None True False async await match case self',
		),
		types: wordSet('int float str bool list dict set tuple bytes object type complex frozenset'),
		capitalisedIsType: true,
	},
	shell: {
		pattern:
			/(?<comment>(?<=^|\s)#[^\n]*)|(?<string>"(?:\\[\s\S]|[^"\\])*"?|'[^']*'?)|(?<attr>\$\{[^}\n]*\}?|\$[A-Za-z_]\w*|\$[@*#?$!\d-])|(?<flag>(?<=\s)--?[A-Za-z][\w-]*)|(?<number>\b\d+\b)|(?<command>(?<=^[ \t]*|[|;&(][ \t]*)[A-Za-z_][\w.\/-]*)|(?<ident>[A-Za-z_][\w.\/-]*)|(?<punct>[{}()[\].,;:?<>=+\-*\/%&|^~!]+)/gm,
		keywords: wordSet(
			'if then else elif fi for while until do done case esac in function return break continue local export readonly declare set unset source exit trap shift eval exec',
		),
		types: NO_WORDS,
	},
	json: {
		pattern:
			/(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/|\/\*[\s\S]*)|(?<attr>"(?:\\[\s\S]|[^"\\])*"(?=[ \t]*:))|(?<string>"(?:\\[\s\S]|[^"\\])*"?)|(?<number>-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(?<ident>\b(?:true|false|null)\b)|(?<punct>[{}[\],:])/g,
		keywords: wordSet('true false null'),
		types: NO_WORDS,
	},
	go: {
		pattern:
			/(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/|\/\*[\s\S]*)|(?<string>"(?:\\[\s\S]|[^"\\\n])*"?|`[^`]*`?|'(?:\\[\s\S]|[^'\\])')|(?<number>\b0[xXbBoO][\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?\b)|(?<ident>[A-Za-z_]\w*)|(?<punct>[{}()[\].,;:?<>=+\-*\/%&|^~!]+)/g,
		keywords: wordSet(
			'package import func var const type struct interface map chan go defer return if else for range switch case default break continue select fallthrough goto',
		),
		types: wordSet(
			'string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 bool byte rune error any nil true false iota',
		),
	},
	sql: {
		pattern:
			/(?<comment>--[^\n]*|\/\*[\s\S]*?\*\/|\/\*[\s\S]*)|(?<string>'(?:''|[^'])*'?|"[^"]*"?)|(?<number>\b\d+(?:\.\d+)?\b)|(?<ident>[A-Za-z_]\w*)|(?<punct>[(),.;*=<>+\-\/|]+)/g,
		keywords: wordSet(
			'select from where join left right inner outer full cross on group by order having limit offset insert into values update set delete create table index view sequence drop alter add column primary key foreign references unique not null default and or in as distinct union all case when then else end with returning exists between like ilike asc desc using constraint begin commit rollback',
		),
		types: wordSet(
			'int integer bigint smallint serial varchar char text boolean bool timestamp timestamptz date time numeric decimal real double uuid json jsonb bytea',
		),
		foldCase: true,
	},
	yaml: {
		pattern:
			/(?<comment>(?<=^|\s)#[^\n]*)|(?<string>"(?:\\[\s\S]|[^"\\\n])*"?|'(?:''|[^'\n])*'?)|(?<attr>(?<=^[ \t]*(?:-[ \t]+)?)[A-Za-z_][\w.\/-]*(?=[ \t]*:))|(?<type>[&*][A-Za-z_][\w-]*)|(?<number>\b\d+(?:\.\d+)?\b)|(?<ident>[A-Za-z_][\w.\/-]*)|(?<punct>[-:|>[\]{},]+)/gm,
		keywords: wordSet('true false null yes no on off'),
		types: NO_WORDS,
		foldCase: true,
	},
	toml: {
		pattern:
			/(?<comment>#[^\n]*)|(?<string>"""[\s\S]*?"""|"""[\s\S]*|'''[\s\S]*?'''|'''[\s\S]*|"(?:\\[\s\S]|[^"\\\n])*"?|'[^'\n]*'?)|(?<type>(?<=^[ \t]*)\[\[?[^\]\n]*\]?\]?)|(?<attr>(?<=^[ \t]*)[A-Za-z_][\w.-]*(?=[ \t]*=))|(?<number>\b\d[\d_]*(?:\.\d+)?\b)|(?<ident>[A-Za-z_][\w-]*)|(?<punct>[=.,[\]{}]+)/gm,
		keywords: wordSet('true false'),
		types: NO_WORDS,
	},
	css: {
		pattern:
			/(?<comment>\/\*[\s\S]*?\*\/|\/\*[\s\S]*|(?<=^|\s)\/\/[^\n]*)|(?<string>"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?)|(?<keyword>@[A-Za-z-]+|![A-Za-z-]+)|(?<attr>(?<=[{;]\s*|^\s*)[-A-Za-z]+(?=[ \t]*:))|(?<number>#[\dA-Fa-f]{3,8}\b|-?\b\d*\.?\d+(?:px|r?em|%|s|ms|vh|vw|fr|deg|ch|pt)?\b)|(?<ident>--[A-Za-z_][\w-]*|\$[A-Za-z_][\w-]*|[A-Za-z_][\w-]*)|(?<punct>[{}();:,>~+*.&]+)/gm,
		keywords: wordSet('inherit initial unset revert none auto currentColor transparent'),
		types: NO_WORDS,
	},
	markdown: {
		pattern:
			/(?<keyword>^#{1,6}[ \t][^\n]*)|(?<comment>^[ \t]*>[^\n]*)|(?<string>`[^`\n]*`?)|(?<type>\*\*[^*\n]+\*\*|__[^_\n]+__)|(?<attr>!?\[[^\]\n]*\])|(?<number>(?<=\])\([^)\n]*\))|(?<punct>^[ \t]*(?:[-*+]|\d+\.)[ \t]|^[ \t]*(?:-{3,}|\*{3,})[ \t]*$)/gm,
		keywords: NO_WORDS,
		types: NO_WORDS,
	},
	c: {
		pattern: pattern(
			String.raw`(?<comment>${SLASH_COMMENTS})|(?<attr>^[ \t]*#[ \t]*[A-Za-z_]\w*)|(?<string>(?<=#[ \t]*(?:include|import)[ \t]*)<[^>\n]*>?|(?:u8|[uUL])?R"\([\s\S]*?\)"|(?:u8|[uUL@])?"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?)|(?<keyword>@[A-Za-z]\w*)|(?<number>${C_NUMBER})|(?<ident>[A-Za-z_]\w*)|(?<punct>${C_PUNCTUATION})`,
			'gm',
		),
		keywords: wordSet(
			'auto break case const continue default do else enum extern for goto if inline register restrict return signed sizeof static struct switch typedef union unsigned volatile while true false NULL nullptr class namespace template typename public private protected virtual override final friend operator new delete this throw try catch using constexpr consteval constinit decltype noexcept static_assert static_cast dynamic_cast reinterpret_cast const_cast mutable explicit export import module concept requires co_await co_return co_yield alignas alignof thread_local self super nil YES NO',
		),
		types: wordSet(
			'int char short long float double void bool size_t ssize_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t uintptr_t intptr_t ptrdiff_t wchar_t char8_t char16_t char32_t std string vector map unordered_map set unique_ptr shared_ptr weak_ptr optional variant id instancetype',
		),
		capitalisedIsType: true,
	},
	csharp: {
		pattern: pattern(
			String.raw`(?<comment>${SLASH_COMMENTS})|(?<attr>^[ \t]*#[ \t]*[A-Za-z_]\w*)|(?<string>\$?"""[\s\S]*?"""|\$?"""[\s\S]*|(?:\$@|@\$|@)"(?:""|[^"])*"?|\$?"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?)|(?<number>${C_NUMBER})|(?<ident>@?[A-Za-z_]\w*)|(?<punct>${C_PUNCTUATION})`,
			'gm',
		),
		keywords: wordSet(
			'abstract as base break case catch checked class const continue default delegate do else enum event explicit extern false finally fixed for foreach goto if implicit in interface internal is lock namespace new null operator out override params private protected public readonly ref return sealed sizeof stackalloc static struct switch this throw true try typeof unchecked unsafe using virtual volatile while async await get set init record required yield when where with nameof partial global value',
		),
		types: wordSet(
			'bool byte char decimal double float int long object sbyte short string uint ulong ushort void dynamic var nint nuint',
		),
		capitalisedIsType: true,
	},
	java: {
		pattern: JVM_PATTERN,
		keywords: wordSet(
			'abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try volatile while var record sealed permits yield true false null def in as trait',
		),
		types: wordSet('boolean byte char double float int long short void'),
		capitalisedIsType: true,
	},
	kotlin: {
		pattern: JVM_PATTERN,
		keywords: wordSet(
			'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor finally get import init set where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg value',
		),
		types: NO_WORDS,
		capitalisedIsType: true,
	},
	swift: {
		pattern: JVM_PATTERN,
		keywords: wordSet(
			'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private precedencegroup protocol public rethrows static struct subscript typealias var break case catch continue default defer do else fallthrough for guard if in repeat return throw switch where while as false is nil self Self super throws true try async await actor some any weak unowned lazy mutating nonmutating override required convenience final dynamic optional indirect get set willSet didSet',
		),
		types: NO_WORDS,
		capitalisedIsType: true,
	},
	php: {
		pattern: pattern(
			String.raw`(?<comment>${SLASH_COMMENTS}|#(?!\[)[^\n]*)|(?<string>"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?)|(?<attr>\$[A-Za-z_]\w*|#\[[^\]\n]*\]?)|(?<number>${C_NUMBER})|(?<ident>[A-Za-z_\\][\w\\]*)|(?<punct>${C_PUNCTUATION})`,
		),
		keywords: wordSet(
			'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null self parent',
		),
		types: wordSet('int float string bool object mixed void never iterable'),
		capitalisedIsType: true,
	},
	ruby: {
		pattern:
			/(?<comment>#[^\n]*|^=begin\b[\s\S]*?^=end\b|^=begin\b[\s\S]*)|(?<string>"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?|%[qQwWiI]?\[[^\]]*\]?|%[qQwWiI]?\([^)]*\)?|`[^`]*`?)|(?<attr>@@?[A-Za-z_]\w*|\$[A-Za-z_]\w*|(?<![\w:]):[A-Za-z_]\w*[?!]?|\b[A-Za-z_]\w*:(?!:))|(?<number>\b0[xXbBoO][\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?\b)|(?<ident>[A-Za-z_]\w*[?!]?)|(?<punct>[{}()[\].,;:?!<>=+\-*\/%&|^~]+)/gm,
		keywords: wordSet(
			'BEGIN END alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require require_relative include extend attr_reader attr_writer attr_accessor private protected public raise lambda proc',
		),
		types: NO_WORDS,
		capitalisedIsType: true,
	},
	lua: {
		pattern:
			/(?<comment>--\[\[[\s\S]*?\]\]|--\[\[[\s\S]*|--[^\n]*)|(?<string>\[\[[\s\S]*?\]\]|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?)|(?<number>\b0[xX][\da-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(?<ident>[A-Za-z_]\w*)|(?<punct>[{}()[\].,;:<>=+\-*\/%#~^]+)/g,
		keywords: wordSet(
			'and break do else elseif end false for function goto if in local nil not or repeat return then true until while self',
		),
		types: NO_WORDS,
	},
	dockerfile: {
		pattern:
			/(?<comment>^[ \t]*#[^\n]*)|(?<keyword>^[ \t]*(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b|\bAS\b)|(?<string>"(?:\\[\s\S]|[^"\\\n])*"?|'[^'\n]*'?)|(?<attr>\$\{[^}\n]*\}?|\$[A-Za-z_]\w*|(?<=\s)--?[A-Za-z][\w-]*)|(?<number>\b\d+(?:\.\d+)*\b)|(?<ident>[A-Za-z_][\w.\/-]*)|(?<punct>[{}()[\],:=&|;\\]+)/gim,
		keywords: NO_WORDS,
		types: NO_WORDS,
	},
	makefile: {
		pattern:
			/(?<comment>#[^\n]*)|(?<keyword>^[ \t]*-?(?:ifeq|ifneq|ifdef|ifndef|else|endif|include|sinclude|define|endef|export|unexport|override|vpath)\b|^\.[A-Z_]+(?=:))|(?<function>^[^\s:=#][^:=#\n]*?(?=:(?!=)))|(?<attr>\$\([^)\n]*\)?|\$\{[^}\n]*\}?|\$[@<^+?*%]|^[A-Za-z_][\w.-]*(?=[ \t]*[:+?!]?=))|(?<string>"(?:\\[\s\S]|[^"\\\n])*"?|'[^'\n]*'?)|(?<number>\b\d+\b)|(?<ident>[A-Za-z_][\w.\/-]*)|(?<punct>[{}()[\],:=;|&@\\-]+)/gm,
		keywords: NO_WORDS,
		types: NO_WORDS,
	},
	ini: {
		pattern:
			/(?<comment>^[ \t]*[;#][^\n]*)|(?<type>^[ \t]*\[[^\]\n]*\]?)|(?<attr>^[ \t]*(?:export[ \t]+)?[^\s=:;#[][^=:\n]*?(?=[ \t]*[=:]))|(?<string>"(?:\\[\s\S]|[^"\\\n])*"?|'[^'\n]*'?)|(?<number>\b\d+(?:\.\d+)*\b)|(?<ident>[A-Za-z_][\w.-]*)|(?<punct>[=:,]+)/gm,
		keywords: wordSet('true false yes no on off null none'),
		types: NO_WORDS,
		foldCase: true,
	},
	graphql: {
		pattern:
			/(?<comment>#[^\n]*)|(?<string>"""[\s\S]*?"""|"""[\s\S]*|"(?:\\[\s\S]|[^"\\\n])*"?)|(?<attr>\$[A-Za-z_]\w*|@[A-Za-z_]\w*)|(?<number>-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(?<ident>[A-Za-z_]\w*)|(?<punct>[{}()[\]:!=|&.,]+)/g,
		keywords: wordSet(
			'query mutation subscription fragment on type interface union enum input scalar schema extend directive implements repeatable true false null',
		),
		types: wordSet('Int Float String Boolean ID'),
		capitalisedIsType: true,
	},
	generic: {
		pattern:
			/(?<comment>(?<=^|[ \t])(?:\/\/|#(?![!{[(]))[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)|(?<string>"(?:\\[\s\S]|[^"\\\n])*"?|`(?:\\[\s\S]|[^`\\])*`?|(?<![\w'])'(?:\\[\s\S]|[^'\\\n])*'(?!\w))|(?<number>\b0[xXbBoO][\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(?<attr>[@$][A-Za-z_]\w*)|(?<ident>[A-Za-z_]\w*)|(?<punct>[{}()[\].,;:?!<>=+\-*\/%&|^~]+)/gm,
		keywords: wordSet(
			'if else elif elsif for foreach while switch break continue return yield goto try catch except finally throw throws raise function func fn def defn lambda class struct enum interface trait impl namespace import export require include extends implements const let var val mut static public private protected internal abstract final override virtual async await null nil None undefined true false True False void typeof instanceof sizeof nullptr',
		),
		types: NO_WORDS,
		capitalisedIsType: true,
	},
};
