import {
  decodeQuotedPrintable,
  extractHtmlFromEml,
  resolveEzgoHtmlFromUpload,
} from "./ezgoEmailHtml";

describe("ezgoEmailHtml", () => {
  test("decodeQuotedPrintable decodes UTF-8 Hebrew", () => {
    const qp = "=D7=9C=D7=90=D7=95=D7=A8=D7=97=D7=99 =D7=94=D7=A1=D7=95=D7=95=D7=99=D7=95=D7=AA";
    expect(decodeQuotedPrintable(qp)).toBe("לאורחי הסוויטות");
  });

  test("extractHtmlFromEml pulls nested table HTML", () => {
    const eml = [
      "Content-Type: multipart/alternative; boundary=abc",
      "",
      "--abc",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "<html><body><table><tr><td>242241: Test</td></tr></table></body></html>",
      "--abc--",
    ].join("\r\n");
    const html = extractHtmlFromEml(eml);
    expect(html).toMatch(/<table/i);
    expect(html).toContain("242241");
  });

  test("resolveEzgoHtmlFromUpload accepts raw HTML paste", () => {
    const html = "<html><body><table><tr><td>1</td></tr></table></body></html>";
    expect(resolveEzgoHtmlFromUpload({ text: html })).toBe(html);
  });
});
