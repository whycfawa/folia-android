package top.izuna.foliamajor;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 汽水加密音频的本地解密代理桥。
 *
 * 协议桥拿到带 spade_a 的加密直链时交给这里；服务器在 127.0.0.1 上按 Range 返回解密后的音频，
 * WebView 的 <audio> 可以直接播。拿不到密钥或服务器起不来时 reject，JS 侧继续退回试听片段。
 */
@CapacitorPlugin(name = "FoliaQishuiAudio")
public class FoliaQishuiAudioPlugin extends Plugin {

    private final QishuiAudioServer server = new QishuiAudioServer();

    @PluginMethod
    public void proxy(PluginCall call) {
        String url = call.getString("url");
        String auth = call.getString("auth", "");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        if (!server.start()) {
            call.reject("Qishui audio proxy could not start");
            return;
        }
        String proxyUrl = server.buildProxyUrl(url, auth);
        if (proxyUrl == null || proxyUrl.isEmpty()) {
            call.reject("Qishui audio proxy is unavailable");
            return;
        }
        JSObject result = new JSObject();
        result.put("url", proxyUrl);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        server.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        server.stop();
        super.handleOnDestroy();
    }
}
