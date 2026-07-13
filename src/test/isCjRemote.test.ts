import * as assert from "assert";
import { isCjRemote } from "../utils/isCjRemote";

const BASE = "https://gitlab.mycj.com";

suite("isCjRemote", () => {
  test("https 同 host -> true", () => {
    assert.strictEqual(
      isCjRemote("https://gitlab.mycj.com/group/repo.git", BASE),
      true
    );
  });

  test("ssh scp 形式 git@host:path -> true", () => {
    assert.strictEqual(
      isCjRemote("git@gitlab.mycj.com:group/repo.git", BASE),
      true
    );
  });

  test("ssh:// 形式 -> true", () => {
    assert.strictEqual(
      isCjRemote("ssh://git@gitlab.mycj.com:22/group/repo.git", BASE),
      true
    );
  });

  test("不同 host -> false", () => {
    assert.strictEqual(
      isCjRemote("https://github.com/other/repo.git", BASE),
      false
    );
  });

  test("host 大小写与端口忽略", () => {
    assert.strictEqual(
      isCjRemote("https://GitLab.MyCj.com:8080/g/r.git", BASE),
      true
    );
  });

  test("baseUrl 带端口时只比 host", () => {
    assert.strictEqual(
      isCjRemote("git@gitlab.mycj.com:g/r.git", "https://gitlab.mycj.com:443"),
      true
    );
  });

  test("baseUrl 未配置(空) -> true 不误杀", () => {
    assert.strictEqual(isCjRemote("git@any.host:g/r.git", ""), true);
  });

  test("remote 为空/异常 -> false", () => {
    assert.strictEqual(isCjRemote("", BASE), false);
    assert.strictEqual(isCjRemote("   ", BASE), false);
    assert.strictEqual(isCjRemote(undefined as any, BASE), false);
  });

  test("子域名不误判(gitlab.mycj.com.evil.com != gitlab.mycj.com)", () => {
    assert.strictEqual(
      isCjRemote("https://gitlab.mycj.com.evil.com/g/r.git", BASE),
      false
    );
  });
});
