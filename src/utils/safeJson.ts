/**
 * 序列化为可安全嵌入内联 <script> 的 JSON 字符串。
 * JSON.stringify 不转义 `<`/`>`（含 `</script>`、`<!--`）及行分隔符 U+2028/U+2029，
 * 会导致脚本提前闭合/XSS，此处统一转成 \uXXXX 转义序列，语义等价但无法闭合标签。
 */
export function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>\u2028\u2029]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")
  );
}
