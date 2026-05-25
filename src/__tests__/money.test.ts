import test from "node:test";
import assert from "node:assert/strict";
import { add, format, gte, isZero, money, sub } from "../shared/money";

test("money rejects non-integer minor", () => {
    assert.throws(() => money(1.5));
});
test("money rejects negative minor", () => {
    assert.throws(() => money(-1));
});
test("add and sub work in INR", () => {
    const a = money(10000);
    const b = money(2500);
    assert.equal(add(a, b).minor, 12500);
    assert.equal(sub(a, b).minor, 7500);
});
test("sub throws on underflow", () => {
    assert.throws(() => sub(money(10), money(11)));
});
test("gte and isZero", () => {
    assert.equal(gte(money(10), money(5)), true);
    assert.equal(isZero(money(0)), true);
    assert.equal(isZero(money(1)), false);
});
test("format prints rupees with 2 decimals", () => {
    assert.equal(format(money(123456)), "INR 1234.56");
});
