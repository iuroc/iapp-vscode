/**
 * iApp 运行时注入的 `i` 对象（Aid_javaCode）只读 stub。
 * 签名来自 `iapp-i-reference.md` 与工程实际用法；只用于 Hover/跳转，不参与用户工程索引。
 */
export const IAPP_STUB_FQCN = "com.iapp.app.Aid_javaCode";

export const IAPP_STUB_SOURCE = `package com.iapp.app;

import android.app.Activity;
import android.content.Context;
import android.view.View;
import java.util.HashMap;

/**
 * iApp 注入的 i 对象。mjava 顶层可直接使用 \`i\`。
 */
public class Aid_javaCode {
    public HashMap a;
    public Activity b;
    public Context c;
    public HashMap d;
    public static HashMap ss_dim;

    /**
     * 加载 mjava 模块到当前解释器。
     */
    public void fn(String name) {
    }

    /** 读取跨 call 共享值。 */
    public Object sss(String key) {
        return null;
    }

    /** 写入跨 call 共享值。 */
    public void sss(String key, Object value) {
    }

    public Object ss(String key) {
        return null;
    }

    public void ss(String key, Object value) {
    }

    public void syso(Object value) {
    }

    public void syso(String value) {
    }

    /**
     * 页面跳转，参数是 iyu 文件名。
     */
    public void uigo(String page) {
    }

    public void uigo(String page, int arg) {
    }

    /**
     * 设置控件属性；第一个参数可以是 View 或控件 id。
     */
    public boolean us(Object target, String key, Object value) {
        return false;
    }

    public Object ug(Object target, String key) {
        return null;
    }

    public String hs(String url) {
        return null;
    }

    public Object call(String lang, String method, Object[] args) {
        return null;
    }

    public void dim(String key, Object value) {
    }

    public View gvs(int id) {
        return null;
    }
}
`;
