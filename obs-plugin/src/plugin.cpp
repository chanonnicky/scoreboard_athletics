#include "dock.hpp"
#include <obs-module.h>
#include <obs-frontend-api.h>
#include <graphics/graphics.h>
#include <util/bmem.h>
#include <QApplication>
#include <QDir>
#include <QFontDatabase>
#include <QJsonDocument>
#include <QMainWindow>
#include <QMetaObject>
#include <QPointer>
#include <array>
#include <memory>
#include <stdexcept>
#include <cstring>

OBS_DECLARE_MODULE()
OBS_MODULE_AUTHOR("CG Live contributors")
MODULE_EXPORT const char *obs_module_description(void) { return "CG Live Native: offline lower thirds with one source and a native dock"; }
namespace {
constexpr const char *SourceId="cg_live_native_source";
constexpr const char *DockId="cg_live_native_dock";
std::unique_ptr<cg::Engine> engine;
QPointer<cg::Dock> dock;
std::array<obs_hotkey_id,23> hotkeys;
std::array<int,23> actions;
QVector<int> fontIds;
bool uiReady=false;
struct Source {
    gs_texture_t *texture=nullptr;
    quint64 serial=~quint64(0);
};
const char *sourceName(void *) {return "CG Live";}
void *create(obs_data_t *,obs_source_t *) {return new Source;}
void destroy(void *data) {
    auto source=static_cast<Source *>(data);obs_enter_graphics();gs_texture_destroy(source->texture);obs_leave_graphics();delete source;
}
uint32_t sourceWidth(void *) {return cg::Width;}
uint32_t sourceHeight(void *) {return cg::Height;}
void render(void *data,gs_effect_t *) {
    if(!engine)return;auto source=static_cast<Source *>(data);quint64 serial=0;const auto frame=engine->frame(serial);
    if(frame.isNull())return;
    if(serial!=source->serial){
        if(!source->texture)source->texture=gs_texture_create(cg::Width,cg::Height,GS_RGBA,1,nullptr,GS_DYNAMIC);
        if(!source->texture)return;
        gs_texture_set_image(source->texture,frame.constBits(),uint32_t(frame.bytesPerLine()),false);source->serial=serial;
    }
    gs_blend_state_push();gs_blend_function(GS_BLEND_ONE,GS_BLEND_INVSRCALPHA);
    auto effect=obs_get_base_effect(OBS_EFFECT_DEFAULT);
    while(gs_effect_loop(effect,"Draw"))obs_source_draw(source->texture,0,0,cg::Width,cg::Height,false);
    gs_blend_state_pop();
}
bool findSource(void *data,obs_source_t *source) {
    if(strcmp(obs_source_get_id(source),SourceId)!=0)return true;
    *static_cast<obs_source_t **>(data)=obs_source_get_ref(source);return false;
}
void addSource() {
    obs_source_t *sceneSource=obs_frontend_preview_program_mode_active()?obs_frontend_get_current_preview_scene():obs_frontend_get_current_scene();
    if(!sceneSource){emit engine->problem(QStringLiteral("กรุณาสร้างหรือเลือก Scene ก่อน"));return;}
    auto scene=obs_scene_from_source(sceneSource);
    if(!scene){obs_source_release(sceneSource);return;}
    obs_source_t *source=nullptr;obs_enum_sources(findSource,&source);
    if(!source)source=obs_source_create(SourceId,"CG Live",nullptr,nullptr);
    if(source){if(!obs_scene_find_source_recursive(scene,obs_source_get_name(source)))obs_scene_add(scene,source);obs_source_release(source);}
    else emit engine->problem(QStringLiteral("สร้าง Source CG Live ไม่สำเร็จ ตรวจ OBS log"));
    obs_source_release(sceneSource);
}
void saveHotkeys() {
    if(!engine)return;QJsonObject keys;
    for(size_t n=0;n<hotkeys.size();++n){
        auto bindings=obs_hotkey_save(hotkeys[n]);auto data=obs_data_create();obs_data_set_array(data,"bindings",bindings);
        keys[QString::number(n)]=QJsonDocument::fromJson(obs_data_get_json(data)).object();obs_data_release(data);obs_data_array_release(bindings);
    }
    engine->store.hotkeys=keys;if(dock)dock->flush();else engine->persist();
}
void frontend(enum obs_frontend_event event,void *) {
    if(!engine)return;
    if(event==OBS_FRONTEND_EVENT_SCENE_COLLECTION_CHANGING)engine->hide(-1,true);
    if(event==OBS_FRONTEND_EVENT_EXIT)saveHotkeys();
}
void hotkey(void *data,obs_hotkey_id,obs_hotkey_t *,bool pressed) {
    if(!pressed||!dock)return;const int action=*static_cast<int *>(data);
    QMetaObject::invokeMethod(dock.data(),[action]{if(!dock||!engine)return;if(action==0)dock->airDraft();else if(action==1)engine->hide(0);else if(action==2)engine->hide();else dock->airIndex(action-3);},Qt::QueuedConnection);
}
}
bool obs_module_load(void) {
    obs_source_info info={};info.id=SourceId;info.type=OBS_SOURCE_TYPE_INPUT;
    info.output_flags=OBS_SOURCE_VIDEO|OBS_SOURCE_CUSTOM_DRAW|OBS_SOURCE_DO_NOT_DUPLICATE;
    info.get_name=sourceName;info.create=create;info.destroy=destroy;info.get_width=sourceWidth;info.get_height=sourceHeight;info.video_render=render;
    obs_register_source(&info);return true;
}
MODULE_EXPORT void obs_module_post_load(void) {
    try {
        char *path=obs_module_config_path("");const auto directory=QString::fromUtf8(path);bfree(path);
        char *fonts=obs_module_file("fonts");if(fonts){QDir dir(QString::fromUtf8(fonts));for(const auto &file:dir.entryList({"*.ttf","*.otf"},QDir::Files)){int id=QFontDatabase::addApplicationFont(dir.filePath(file));if(id>=0)fontIds.append(id);}bfree(fonts);}
        engine=std::make_unique<cg::Engine>(directory);
        dock=new cg::Dock(*engine,addSource,static_cast<QMainWindow *>(obs_frontend_get_main_window()));
        if(!obs_frontend_add_dock_by_id(DockId,"CG Live · Lower Third",dock))throw std::runtime_error("Could not register CG Live dock");
        for(size_t n=0;n<hotkeys.size();++n){
            actions[n]=int(n);auto name=QString("CG Live: %1").arg(n==0?QStringLiteral("ขึ้นฉบับร่าง"):n==1?QStringLiteral("ลงแถบหลัก"):n==2?QStringLiteral("ลงจอทั้งหมด"):QStringLiteral("ขึ้นรายการ %1").arg(n-2)).toUtf8();
            const auto id=QString("cg_live.action.%1").arg(n).toUtf8();hotkeys[n]=obs_hotkey_register_frontend(id.constData(),name.constData(),hotkey,&actions[n]);
            const auto json=QJsonDocument(engine->store.hotkeys[QString::number(n)].toObject()).toJson(QJsonDocument::Compact);auto data=obs_data_create_from_json(json.constData());
            if(data){auto bindings=obs_data_get_array(data,"bindings");if(bindings){obs_hotkey_load(hotkeys[n],bindings);obs_data_array_release(bindings);}obs_data_release(data);}
        }
        obs_frontend_add_event_callback(frontend,nullptr);
        uiReady=true;
        blog(LOG_INFO,"[CG Live] Native dock ready; no server or browser dependency");
    } catch(const std::exception &error) {blog(LOG_ERROR,"[CG Live] Startup failed: %s",error.what());if(dock){delete dock.data();dock=nullptr;}engine.reset();}
}
void obs_module_unload(void) {
    if(uiReady){
        obs_frontend_remove_event_callback(frontend,nullptr);
        saveHotkeys();for(auto id:hotkeys)obs_hotkey_unregister(id);
        obs_frontend_remove_dock(DockId);uiReady=false;
    }
    if(dock){delete dock.data();dock=nullptr;}engine.reset();
    for(int id:fontIds)QFontDatabase::removeApplicationFont(id);fontIds.clear();
}

#ifdef CG_NATIVE_TEST
// Only the non-installed test module exposes these hooks. Production has no test API.
MODULE_EXPORT cg::Engine *cg_native_test_start(const char *directory) {
    engine=std::make_unique<cg::Engine>(QString::fromUtf8(directory));return engine.get();
}
MODULE_EXPORT void cg_native_test_stop(void) {engine.reset();}
#endif
