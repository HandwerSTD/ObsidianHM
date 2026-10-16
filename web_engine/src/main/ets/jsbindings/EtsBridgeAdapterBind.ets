// Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * EtsBridgeAdapterBind - Registers EtsBridgeAdapter methods into AKI framework.
 *
 * Uses JsBindingUtils.bindFunction() to expose ArkTS functions to C++.
 * C++ retrieves them via ohos::adapter::GetJSFunction("EtsBridge.Xxx")
 * and calls them through AKI's JSFunction::Invoke<R>(...).
 *
 * Naming convention:
 *   Binding name: "EtsBridge.<PascalCaseMethodName>"
 *   Example:      "EtsBridge.TestReturnString"
 *
 * Each wrapper function signature must match the corresponding
 * EtsBridgeAdapter method exactly, since AKI validates types
 * at the C++ Invoke call site.
 */

import JsBindingUtils from '../utils/JsBindingUtils';
import Inject from "../common/InjectModule";
import { common } from '@kit.AbilityKit';
import lazy { EtsBridgeAdapter } from '../adapter/EtsBridgeAdapter';
import lazy { DeeplinkPusher } from '../adapter/DeeplinkPusher';

/** Get or create EtsBridgeAdapter singleton */
function implEtsBridgeAdapter(): EtsBridgeAdapter {
    return Inject.getOrCreate(EtsBridgeAdapter);
}

/** Get or create DeeplinkPusher singleton */
function implDeeplinkPusher(): DeeplinkPusher {
    return Inject.getOrCreate(DeeplinkPusher);
}

// ============================================================
// Section 1: No parameters + various return types
// ============================================================

function testReturnArrayString(): Array<string> {
    return implEtsBridgeAdapter().testReturnArrayString();
}

function testReturnArrayNumber(): Array<number> {
    return implEtsBridgeAdapter().testReturnArrayNumber();
}

function testReturnString(): string {
    return implEtsBridgeAdapter().testReturnString();
}

function testReturnNumber(): number {
    return implEtsBridgeAdapter().testReturnNumber();
}

function testReturnBoolean(): boolean {
    return implEtsBridgeAdapter().testReturnBoolean();
}

function testVoidReturn(): void {
    implEtsBridgeAdapter().testVoidReturn();
}

// ============================================================
// Section 2: Single parameter + return value
// ============================================================

function testReturnByStringParam(param: string): string {
    return implEtsBridgeAdapter().testReturnByStringParam(param);
}

function testReturnByNumberParam(param: number): number {
    return implEtsBridgeAdapter().testReturnByNumberParam(param);
}

function testReturnByBooleanParam(param: boolean): boolean {
    return implEtsBridgeAdapter().testReturnByBooleanParam(param);
}

function testReturnByStringArrayParam(param: Array<string>): Array<string> {
    return implEtsBridgeAdapter().testReturnByStringArrayParam(param);
}

function testReturnByNumberArrayParam(param: Array<number>): Array<number> {
    return implEtsBridgeAdapter().testReturnByNumberArrayParam(param);
}

// ============================================================
// Section 3: Multiple parameters (mixed types)
// ============================================================

function testTwoParams(param1: string, param2: number): string {
    return implEtsBridgeAdapter().testTwoParams(param1, param2);
}

function testMultipleParams(param1: string, param2: number, param3: boolean): string {
    return implEtsBridgeAdapter().testMultipleParams(param1, param2, param3);
}

function testVoidReturnWithParams(param1: string, param2: number, param3: boolean): void {
    implEtsBridgeAdapter().testVoidReturnWithParams(param1, param2, param3);
}

function testThreeNumbers(a: number, b: number, c: number): number {
    return implEtsBridgeAdapter().testThreeNumbers(a, b, c);
}

function testTwoStrings(a: string, b: string): string {
    return implEtsBridgeAdapter().testTwoStrings(a, b);
}

// ============================================================
// Section 4: Numeric boundary / special values
// ============================================================

function testReturnFloat(): number {
    return implEtsBridgeAdapter().testReturnFloat();
}

function testReturnNegativeNumber(): number {
    return implEtsBridgeAdapter().testReturnNegativeNumber();
}

function testReturnZero(): number {
    return implEtsBridgeAdapter().testReturnZero();
}

function testReturnFalse(): boolean {
    return implEtsBridgeAdapter().testReturnFalse();
}

function testReturnLargeNumber(): number {
    return implEtsBridgeAdapter().testReturnLargeNumber();
}

// ============================================================
// Section 5: Empty values / empty collections
// ============================================================

function testReturnEmptyString(): string {
    return implEtsBridgeAdapter().testReturnEmptyString();
}

function testReturnEmptyNumberArray(): Array<number> {
    return implEtsBridgeAdapter().testReturnEmptyNumberArray();
}

function testReturnEmptyStringArray(): Array<string> {
    return implEtsBridgeAdapter().testReturnEmptyStringArray();
}

function testReturnArrayWithEmptyStrings(): Array<string> {
    return implEtsBridgeAdapter().testReturnArrayWithEmptyStrings();
}

// ============================================================
// Section 6: Special string content
// ============================================================

function testReturnChineseString(): string {
    return implEtsBridgeAdapter().testReturnChineseString();
}

function testReturnSpecialChars(): string {
    return implEtsBridgeAdapter().testReturnSpecialChars();
}

function testEchoString(param: string): string {
    return implEtsBridgeAdapter().testEchoString(param);
}

// ============================================================
// Section 7: Large arrays
// ============================================================

function testReturnLargeNumberArray(): Array<number> {
    return implEtsBridgeAdapter().testReturnLargeNumberArray();
}

function testReturnLargeStringArray(): Array<string> {
    return implEtsBridgeAdapter().testReturnLargeStringArray();
}

// ============================================================
// Section 8: 回调参数机制
//   delayMs 用 number 参数；callback 走 C++ 桥的 Function 参数路径，
//   按 Function.length 自动选择 function（1 参）或 function0（0 参）。
//   注意 wrapper 不能给 callback 加默认值或 rest 参数，那会把
//   Function.length 变成 0，C++ 侧会选错参数分支。
// ============================================================

function testCallbackString(delayMs: number, callback: (value: string) => void): void {
    implEtsBridgeAdapter().testCallbackString(delayMs, callback);
}

function testCallbackMultiTypes(callback: (value: ESObject) => void): void {
    implEtsBridgeAdapter().testCallbackMultiTypes(callback);
}

function testCallbackLongDelay(callback: (value: string) => void): void {
    implEtsBridgeAdapter().testCallbackLongDelay(callback);
}

// ============================================================
// Section 9: deeplink 推送
//   JS 侧把回调传入并长期持有，之后 obsidian:// 链接由 ArkTS 主动推送。
//   filesDir 取 applicationContext 的，与 Electron 的 userData 同一目录。
// ============================================================

function subscribeDeeplink(callback: (url: string) => void): void {
    let appContext = getContext().getApplicationContext() as common.ApplicationContext;
    implDeeplinkPusher().subscribe(callback, appContext.filesDir);
}

// ============================================================
// Bind all functions to AKI
// ============================================================

export class EtsBridgeAdapterBind {
  static bind() {
    // Section 1: No params + various return types
    JsBindingUtils.bindFunction("EtsBridge.TestReturnArrayString", testReturnArrayString);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnArrayNumber", testReturnArrayNumber);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnString", testReturnString);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnNumber", testReturnNumber);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnBoolean", testReturnBoolean);
    JsBindingUtils.bindFunction("EtsBridge.TestVoidReturn", testVoidReturn);

    // Section 2: Single param + return value
    JsBindingUtils.bindFunction("EtsBridge.TestReturnByStringParam", testReturnByStringParam);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnByNumberParam", testReturnByNumberParam);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnByBooleanParam", testReturnByBooleanParam);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnByStringArrayParam", testReturnByStringArrayParam);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnByNumberArrayParam", testReturnByNumberArrayParam);

    // Section 3: Multiple params (mixed types)
    JsBindingUtils.bindFunction("EtsBridge.TestTwoParams", testTwoParams);
    JsBindingUtils.bindFunction("EtsBridge.TestMultipleParams", testMultipleParams);
    JsBindingUtils.bindFunction("EtsBridge.TestVoidReturnWithParams", testVoidReturnWithParams);
    JsBindingUtils.bindFunction("EtsBridge.TestThreeNumbers", testThreeNumbers);
    JsBindingUtils.bindFunction("EtsBridge.TestTwoStrings", testTwoStrings);

    // Section 4: Numeric boundary / special values
    JsBindingUtils.bindFunction("EtsBridge.TestReturnFloat", testReturnFloat);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnNegativeNumber", testReturnNegativeNumber);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnZero", testReturnZero);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnFalse", testReturnFalse);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnLargeNumber", testReturnLargeNumber);

    // Section 5: Empty values / empty collections
    JsBindingUtils.bindFunction("EtsBridge.TestReturnEmptyString", testReturnEmptyString);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnEmptyNumberArray", testReturnEmptyNumberArray);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnEmptyStringArray", testReturnEmptyStringArray);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnArrayWithEmptyStrings", testReturnArrayWithEmptyStrings);

    // Section 6: Special string content
    JsBindingUtils.bindFunction("EtsBridge.TestReturnChineseString", testReturnChineseString);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnSpecialChars", testReturnSpecialChars);
    JsBindingUtils.bindFunction("EtsBridge.TestEchoString", testEchoString);

    // Section 7: Large arrays
    JsBindingUtils.bindFunction("EtsBridge.TestReturnLargeNumberArray", testReturnLargeNumberArray);
    JsBindingUtils.bindFunction("EtsBridge.TestReturnLargeStringArray", testReturnLargeStringArray);

    // Section 8: 回调参数机制
    JsBindingUtils.bindFunction("EtsBridge.TestCallbackString", testCallbackString);
    JsBindingUtils.bindFunction("EtsBridge.TestCallbackMultiTypes", testCallbackMultiTypes);
    JsBindingUtils.bindFunction("EtsBridge.TestCallbackLongDelay", testCallbackLongDelay);

    // Section 9: deeplink 推送
    JsBindingUtils.bindFunction("EtsBridge.SubscribeDeeplink", subscribeDeeplink);
  }
}
