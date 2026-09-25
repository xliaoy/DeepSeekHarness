package com.deepseekharness.app.ui;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import com.deepseekharness.app.util.PluginInstallLink;
/** 两个网页内核共用插件导航；安装仍经过原生预览、内容复核和维护屏障。 */
final class PluginNavigation {
    private PluginNavigation(){}
    static boolean open(Activity activity,String url){
        try{PluginInstallLink.parse(url);}catch(IllegalArgumentException ordinary){return false;}
        activity.startActivity(new Intent(activity,PluginInstallActivity.class).setData(Uri.parse(url)));return true;
    }
}
