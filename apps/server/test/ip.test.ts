import { describe, expect, it } from "vitest";
import { clientIp, ipBucket } from "#abuse/ip.ts";

describe("ipBucket", () => {
  it.each([
    ["an IPv4 address", "203.0.113.7", "203.0.113.7"],
    ["an IPv4-mapped IPv6 address", "::ffff:203.0.113.7", "203.0.113.7"],
    ["IPv6 by its /64", "2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"],
    ["a shortened IPv6", "2001:db8::1", "2001:db8:0:0::/64"],
    ["IPv6 in capitals with leading zeros", "2001:0DB8:0001:0002::1", "2001:db8:1:2::/64"],
    ["IPv6 with a zone", "fe80::1%en0", "fe80:0:0:0::/64"],
    ["IPv6 loopback", "::1", "0:0:0:0::/64"],
    ["no address", undefined, "unknown"],
    ["something else", "not an ip", "unknown"],
  ])("%s", (_, ip, bucket) => {
    expect(ipBucket(ip)).toBe(bucket);
  });

  it("puts two addresses of one /64 in one bucket, and the next /64 in another", () => {
    expect(ipBucket("2001:db8:1:2::1")).toBe(ipBucket("2001:db8:1:2:ffff::9"));
    expect(ipBucket("2001:db8:1:3::1")).not.toBe(ipBucket("2001:db8:1:2::1"));
  });
});

describe("clientIp", () => {
  it("prefers X-Real-IP (Caddy sets it), as Colyseus does", () => {
    expect(
      clientIp({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "192.0.2.9" }, "10.0.0.1"),
    ).toBe("198.51.100.1");
  });

  it("then the first hop of X-Forwarded-For, then X-Client-IP", () => {
    expect(clientIp({ "x-forwarded-for": "192.0.2.9, 10.0.0.2" }, "10.0.0.1")).toBe("192.0.2.9");
    expect(clientIp({ "x-client-ip": "192.0.2.10" }, "10.0.0.1")).toBe("192.0.2.10");
  });

  it("falls back to the socket's address", () => {
    expect(clientIp({}, "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIp({ "x-real-ip": "" }, "127.0.0.1")).toBe("127.0.0.1");
  });
});
