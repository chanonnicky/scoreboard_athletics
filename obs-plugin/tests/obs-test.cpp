#include "model.hpp"
#include "renderer.hpp"
#include <obs.h>
#include <graphics/graphics.h>
#include <graphics/vec4.h>
#include <util/platform.h>
#include <QApplication>
#include <QDir>
#include <QFontDatabase>
#include <QLibrary>
#include <QTemporaryDir>
#include <iostream>
#include <stdexcept>

static void check(bool value,const char *message){if(!value)throw std::runtime_error(message);}
int main(int argc,char **argv){
    QApplication app(argc,argv);
    if(argc<4){std::cerr<<"Usage: cg-obs-tests <smoke-module> <OBS-data/libobs> <graphics-module>\n";return 2;}
    QTemporaryDir temp;bool started=false;obs_source_t *source=nullptr;gs_texrender_t *target=nullptr;gs_stagesurf_t *stage=nullptr;bool graphics=false;
    using Start=cg::Engine *(*)(const char *);using Stop=void (*)();Stop stop=nullptr;
    try{
        QDir fonts(qEnvironmentVariable("CG_FONT_DIR"));for(const auto &file:fonts.entryList({"*.ttf"},QDir::Files))QFontDatabase::addApplicationFont(fonts.filePath(file));
        // Match the installed runtime's working directory; OBS finds ../../data/libobs.
        QDir::setCurrent(QFileInfo(QString::fromUtf8(argv[3])).absolutePath());
        check(obs_startup("en-US",temp.path().toUtf8().constData(),nullptr),"obs startup");started=true;
        std::cout<<"Runtime OBS "<<obs_get_version_string()<<" / Qt "<<qVersion()<<'\n';
        obs_video_info video={};video.graphics_module=argv[3];video.fps_num=60;video.fps_den=1;video.base_width=1920;video.base_height=1080;video.output_width=1920;video.output_height=1080;video.output_format=VIDEO_FORMAT_RGBA;video.colorspace=VIDEO_CS_709;video.range=VIDEO_RANGE_FULL;video.scale_type=OBS_SCALE_BILINEAR;
        check(obs_reset_video(&video)==OBS_VIDEO_SUCCESS,"video reset");
#ifdef Q_OS_WIN
        QLibrary frontend(QFileInfo(QString::fromUtf8(argv[3])).dir().filePath("obs-frontend-api.dll"));
        check(frontend.load(),"frontend runtime loads");
#endif
        obs_module_t *module=nullptr;check(obs_open_module(&module,argv[1],argv[2])==MODULE_SUCCESS,"module loads");check(obs_init_module(module),"module initializes");
        QLibrary hooks(QString::fromUtf8(argv[1]));check(hooks.load(),"resolve test hooks");auto start=reinterpret_cast<Start>(hooks.resolve("cg_native_test_start"));stop=reinterpret_cast<Stop>(hooks.resolve("cg_native_test_stop"));check(start&&stop,"test hooks found");
        auto engine=start(temp.path().toUtf8().constData());source=obs_source_create("cg_live_native_source","CG Live integration",nullptr,nullptr);check(source,"native source created");
        check(obs_source_get_width(source)==1920&&obs_source_get_height(source)==1080,"source dimensions");
        cg::Item item;item.line1=QStringLiteral("ทดสอบ Native ใน OBS จริง");item.line2=QStringLiteral("ไม่ใช้ Browser หรือ Server");item.animMs=0;item.opacity=50;engine->air(item);cg::Renderer renderer(engine->store);engine->publish(renderer.render(engine->layers,cg::nowMs()));
        obs_enter_graphics();graphics=true;target=gs_texrender_create(GS_RGBA,GS_ZS_NONE);stage=gs_stagesurface_create(1920,1080,GS_RGBA);check(target&&stage,"GPU surfaces");
        check(gs_texrender_begin(target,1920,1080),"GPU render begin");vec4 clear;vec4_zero(&clear);gs_clear(GS_CLEAR_COLOR,&clear,0,0);gs_ortho(0,1920,0,1080,-100,100);obs_source_video_render(source);gs_texrender_end(target);
        gs_stage_texture(stage,gs_texrender_get_texture(target));uint8_t *pixels=nullptr;uint32_t stride=0;check(gs_stagesurface_map(stage,&pixels,&stride),"GPU readback");
        QImage image(pixels,1920,1080,int(stride),QImage::Format_RGBA8888_Premultiplied);auto captured=image.copy();gs_stagesurface_unmap(stage);
        const auto pixel=captured.pixelColor(150,850);check(pixel.alpha()>100&&pixel.alpha()<150,"50% alpha survives native GPU source");check(captured.pixelColor(0,0).alpha()==0,"background remains transparent");
        quint64 frameSerial=0;auto expected=engine->frame(frameSerial).pixelColor(150,850);
        check(std::abs(pixel.red()-expected.red())<=3&&std::abs(pixel.green()-expected.green())<=3&&std::abs(pixel.blue()-expected.blue())<=3,"GPU preserves premultiplied surface color");
        const auto output=qEnvironmentVariable("CG_TEST_OUTPUT");if(!output.isEmpty())captured.save(output+"/obs-gpu.png");
        // Every appearance reuses the same registered source, including separate scenes.
        auto first=obs_scene_create_private("first"),second=obs_scene_create_private("second");obs_scene_add(first,source);obs_scene_add(second,source);check(obs_scene_find_source(first,"CG Live integration")&&obs_scene_find_source(second,"CG Live integration"),"same source in two scenes");obs_scene_release(first);obs_scene_release(second);
        gs_stagesurface_destroy(stage);stage=nullptr;gs_texrender_destroy(target);target=nullptr;obs_leave_graphics();graphics=false;
        obs_source_release(source);source=nullptr;obs_wait_for_destroy_queue();stop();stop=nullptr;obs_shutdown();started=false;
        std::cout<<"PASS: actual libobs runtime, module load, native GPU render, transparent alpha, shared source, clean shutdown\n";return 0;
    }catch(const std::exception &e){
        if(stage)gs_stagesurface_destroy(stage);if(target)gs_texrender_destroy(target);if(graphics)obs_leave_graphics();if(source)obs_source_release(source);if(started)obs_wait_for_destroy_queue();if(stop)stop();if(started)obs_shutdown();std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;
    }
}
