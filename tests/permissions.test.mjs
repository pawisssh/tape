import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { isInsecureUrl } from "../src/lib/permissions.ts"

describe("isInsecureUrl", () => {
    test("https:// is never flagged, regardless of host", () => {
        assert.equal(isInsecureUrl("https://example.com"), false)
        assert.equal(isInsecureUrl("https://api.some-cloud-provider.com/v1"), false)
        assert.equal(isInsecureUrl("https://localhost:1234"), false)
    })

    test("http:// to localhost/loopback is not flagged", () => {
        assert.equal(isInsecureUrl("http://localhost:1234/v1"), false)
        assert.equal(isInsecureUrl("http://127.0.0.1:11434/v1"), false)
        assert.equal(isInsecureUrl("http://[::1]:8080"), false)
    })

    test("http:// to a private-network address is not flagged", () => {
        assert.equal(isInsecureUrl("http://192.168.1.50:1234"), false)
        assert.equal(isInsecureUrl("http://10.0.0.5:8080"), false)
        assert.equal(isInsecureUrl("http://172.16.0.1"), false)
        assert.equal(isInsecureUrl("http://172.31.255.255"), false)
        assert.equal(isInsecureUrl("http://169.254.1.1"), false)
    })

    test("http:// to a public host is flagged", () => {
        assert.equal(isInsecureUrl("http://example.com"), true)
        assert.equal(isInsecureUrl("http://my-webhook-receiver.io/hook"), true)
        assert.equal(isInsecureUrl("http://8.8.8.8"), true)
    })

    test("addresses just outside the private ranges are still flagged (boundary check)", () => {
        assert.equal(isInsecureUrl("http://172.15.0.1"), true) // below 172.16.0.0/12
        assert.equal(isInsecureUrl("http://172.32.0.1"), true) // above 172.31.255.255
        assert.equal(isInsecureUrl("http://192.169.1.1"), true) // not 192.168.0.0/16
    })

    test("unparseable input never throws, resolves to false", () => {
        assert.equal(isInsecureUrl(""), false)
        assert.equal(isInsecureUrl("not a url"), false)
    })
})
