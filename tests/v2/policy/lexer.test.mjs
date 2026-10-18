// Unit tests for src/core/policy/lexer.ts (impl/08 §1, DECISIONS-r9 P1, P3, E1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lex, scan, dequote, substitutions, isAssignment } from "../../../src/core/policy/lexer.ts";

const kinds = (cmd) => lex(cmd).map((t) => `${t.kind}:${t.text}`);

test("plain words and flags are word tokens with source offsets", () => {
  const t = lex("curl -sL https://x.io/f");
  assert.deepEqual(t.map((x) => x.text), ["curl", "-sL", "https://x.io/f"]);
  assert.ok(t.every((x) => x.kind === "word"));
  assert.deepEqual([t[1].start, t[1].end], [5, 8]);
});

test("ops: && || ; | ( ) longest match first", () => {
  assert.deepEqual(kinds("a&&b||c;d|e"), ["word:a", "op:&&", "word:b", "op:||", "word:c", "op:;", "word:d", "op:|", "word:e"]);
  assert.deepEqual(kinds("( a )"), ["op:(", "word:a", "op:)"]);
  assert.deepEqual(kinds("a & b"), ["word:a", "op:&", "word:b"]);
});

test("io: > >> < 2> 2>&1 &> << <<- <<<", () => {
  assert.deepEqual(kinds("a > f >> g < h 2> e 2>&1 &> x"),
    ["word:a", "io:>", "word:f", "io:>>", "word:g", "io:<", "word:h", "io:2>", "word:e", "io:2>&1", "io:&>", "word:x"]);
  assert.deepEqual(kinds("grep x <<< hi"), ["word:grep", "word:x", "io:<<<", "word:hi"]);
});

test("quotes: quoted text stays one word, never ops (P3)", () => {
  assert.deepEqual(kinds(`git log --grep="curl && wget"`), [`word:git`, `word:log`, `word:--grep="curl && wget"`]);
  assert.deepEqual(kinds(`echo 'a; [[ b'`), [`word:echo`, `word:'a; [[ b'`]);
  assert.deepEqual(kinds(`echo "curl \\"https://x.io/a.json\\""`), [`word:echo`, `word:"curl \\"https://x.io/a.json\\""`]);
});

test("nested quote stack: $( ) inside double quotes pops back to the double quote", () => {
  assert.deepEqual(kinds(`echo "$(echo "a b")" c`), [`word:echo`, `word:"$(echo "a b")"`, `word:c`]);
});

test("$( ) and backticks alone are one unhandled token", () => {
  assert.deepEqual(kinds("echo $(curl -s x | wc) `id`"), ["word:echo", "unhandled:$(curl -s x | wc)", "unhandled:`id`"]);
  assert.deepEqual(kinds("echo $((1+1))"), ["word:echo", "unhandled:$((1+1))"]);
});

test("[[ ]] and (( )) are unhandled spans (P1)", () => {
  assert.deepEqual(kinds("[[ -f a.txt && -n $x ]] && echo ok"), ["unhandled:[[ -f a.txt && -n $x ]]", "op:&&", "word:echo", "word:ok"]);
  assert.deepEqual(kinds("(( i > 3 )); echo"), ["unhandled:(( i > 3 ))", "op:;", "word:echo"]);
});

test("process substitution is an unhandled span", () => {
  assert.deepEqual(kinds("diff <(curl -s x) >(cat)"), ["word:diff", "unhandled:<(curl -s x)", "unhandled:>(cat)"]);
});

test("case and function words stay plain words; coproc and select too", () => {
  assert.deepEqual(kinds("f() { a; }"), ["word:f", "op:(", "op:)", "word:{", "word:a", "op:;", "word:}"]);
  assert.deepEqual(kinds("case $1 in x) a;; esac"), ["word:case", "word:$1", "word:in", "word:x", "op:)", "word:a", "op:;;", "word:esac"]);
  assert.deepEqual(kinds("coproc x"), ["word:coproc", "word:x"]);
});

test("E1: unquoted LF / CR / CRLF is an op ;", () => {
  assert.deepEqual(kinds("pwd\nrm -rf /tmp/x"), ["word:pwd", "op:;", "word:rm", "word:-rf", "word:/tmp/x"]);
  assert.deepEqual(kinds("a\rb\r\nc"), ["word:a", "op:;", "word:b", "op:;", "word:c"]);
  assert.deepEqual(kinds(`echo "a\nb"`), [`word:echo`, `word:"a\nb"`]);
});

test("E1: backslash-LF is a line continuation, no token", () => {
  assert.deepEqual(kinds("npm run build \\\n  --silent"), ["word:npm", "word:run", "word:build", "word:--silent"]);
});

test("heredoc body is one unhandled token after the newline op", () => {
  const s = scan("cat <<EOF\ncurl -s https://x.io\nEOF\necho done");
  assert.deepEqual(s.tokens.map((t) => `${t.kind}:${t.text}`),
    ["word:cat", "io:<<", "word:EOF", "op:;", "unhandled:curl -s https://x.io\nEOF\n", "word:echo", "word:done"]);
  assert.deepEqual(s.heredocBodies, [4]);
  assert.equal(s.end, "complete");
});

test("heredoc <<- strips whitespace around the tag; quoted tag", () => {
  assert.equal(scan("cat <<-'END'\n\tx\n\tEND\n").end, "complete");
  assert.equal(scan("cat <<\"END\"\nx\nEND").end, "complete");
});

test("unterminated quote / heredoc consume to end, never throw", () => {
  const q = scan(`echo "unterminated`);
  assert.equal(q.end, "unterminated-quote");
  assert.deepEqual(q.tokens.map((t) => t.text), ["echo", `"unterminated`]);
  assert.equal(scan("echo 'x").end, "unterminated-quote");
  assert.equal(scan("cat <<EOF\nbody").end, "unterminated-heredoc");
  assert.equal(scan("cat <<EOF").end, "unterminated-heredoc");
});

test("heredoc inside $( ) inside double quotes: apostrophes in the body are not quotes", () => {
  const s = scan(`git commit -m "$(cat <<'EOF'\nit's done\nEOF\n)"`);
  assert.equal(s.end, "complete");
  assert.equal(s.tokens.length, 4);
});

test("comments are skipped at word start only", () => {
  assert.deepEqual(kinds("echo a # curl don't\nls"), ["word:echo", "word:a", "op:;", "word:ls"]);
  assert.deepEqual(kinds("echo a#b"), ["word:echo", "word:a#b"]);
});

test("lexer never throws on odd input", () => {
  for (const s of ["", "\\", "$(", "`", "[[", "((", "<<", "'", '"', "a\\", ")(", "<(", "<<-", "&>", "${a b}"]) lex(s);
});

test("dequote strips quote characters and escapes", () => {
  assert.equal(dequote(`"curl"`), "curl");
  assert.equal(dequote(`'a b'c\\ d`), "a bc d");
  assert.equal(dequote(`"a \\"b\\" \\$x"`), `a "b" $x`);
});

test("substitutions finds $( ), backticks, <( ) outside single quotes; skips $(( ))", () => {
  assert.deepEqual(substitutions(`echo "$(curl -s x)" '$(no)' \`id\` $((1+1)) <(a) >(b)`), [
    { wrapper: "$()", body: "curl -s x" },
    { wrapper: "`", body: "id" },
    { wrapper: "<()", body: "a" },
    { wrapper: ">()", body: "b" },
  ]);
  assert.deepEqual(substitutions(`echo "<(x)"`), []);
});

test("isAssignment: NAME=val only", () => {
  assert.equal(isAssignment("FOO=1"), true);
  assert.equal(isAssignment("_a1=x y"), true);
  assert.equal(isAssignment("1A=x"), false);
  assert.equal(isAssignment("--a=b"), false);
  assert.equal(isAssignment("curl"), false);
});
