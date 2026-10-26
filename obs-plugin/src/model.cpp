#include "model.hpp"
#include <QBuffer>
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QImageReader>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMutexLocker>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSet>
#include <QUuid>
#include <algorithm>
#include <chrono>
#include <stdexcept>

namespace cg {
static void fail(const QString &message) { throw std::runtime_error(message.toStdString()); }
QStringList types() { return {"name", "topic", "nameCard", "strap", "ticker", "logo"}; }
QStringList typeLabels() { return {QStringLiteral("ชื่อ–ตำแหน่ง"), QStringLiteral("หัวข้อ"), QStringLiteral("ชื่อพร้อมรูป"), QStringLiteral("แถบเต็มความกว้าง"), QStringLiteral("แถบวิ่ง"), QStringLiteral("โลโก้มุมจอ")}; }
QStringList themes() { return {"default","glass","clay","claydark","neu","retro","editorial","broken","bauhaus","techno","popart","illustrative","y2k","swiss","pastel"}; }
QStringList themeLabels() { return {"Default","Glass","Clay","Clay Dark","Neumorphism","Retro","Editorial","Asymmetrical","Bauhaus","Techno","Pop Art","Illustrative","Y2K","Swiss","Pastel"}; }
int layerFor(const QString &type) { return type == "ticker" ? 1 : type == "logo" ? 2 : 0; }
qint64 nowMs() { return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
static QString option(const QJsonObject &j, const char *key, const QStringList &allowed, const QString &fallback) {
    auto v = j.value(key).toString(fallback); return allowed.contains(v) ? v : fallback;
}
QJsonObject Item::json() const {
    QJsonObject j;
#define TEXT(k) j[#k] = k
    TEXT(id); TEXT(name); TEXT(type); TEXT(line1); TEXT(line2); TEXT(label); TEXT(image); TEXT(logo);
    TEXT(theme); TEXT(accent); TEXT(ink); TEXT(background); TEXT(font); TEXT(align); TEXT(animation); TEXT(exitAnimation);
    TEXT(fontSize); TEXT(x); TEXT(y); TEXT(width); TEXT(opacity); TEXT(duration); TEXT(animMs); TEXT(exitMs); TEXT(tickerSec);
#undef TEXT
    return j;
}
Item Item::fromJson(const QJsonObject &j) {
    Item i;
#define STR(k, max) i.k = j.value(#k).toString(i.k).left(max)
    STR(id, 80); STR(name, 120); STR(line1, 8000); STR(line2, 2000); STR(label, 120);
    STR(image, 80); STR(logo, 80); STR(font, 160);
#undef STR
    i.type = option(j,"type",types(),i.type); i.theme = option(j,"theme",themes(),i.theme);
    i.align = option(j,"align",{"left","center","right"},i.align);
    i.animation = option(j,"animation",{"theme","slide","fade","wipe","type"},"slide");
    i.exitAnimation = option(j,"exitAnimation",{"theme","slide","fade","wipe"},"fade");
    if(!j.contains("exitMs"))i.exitMs=300;
    i.background = option(j,"background",{"solid","grad","glass","none"},i.background);
    const QRegularExpression color("^#[0-9a-fA-F]{6}$");
    if (color.match(j.value("accent").toString()).hasMatch()) i.accent = j["accent"].toString();
    i.ink = option(j,"ink",{"auto","light","dark"},i.ink);
#define NUM(k, lo, hi) i.k = std::clamp(j.value(#k).toInt(i.k), lo, hi)
    NUM(fontSize,18,120); NUM(x,0,1800); NUM(y,0,1040); NUM(width,120,1920);
    NUM(opacity,0,100); NUM(duration,0,86400); NUM(animMs,0,3000); NUM(exitMs,0,3000); NUM(tickerSec,2,300);
#undef NUM
    return i;
}
static QByteArray read(const QString &path, qint64 limit = 64*1024*1024) {
    QFile f(path); if (!f.open(QIODevice::ReadOnly) || f.size() > limit) fail(QStringLiteral("อ่านไฟล์ไม่ได้หรือไฟล์ใหญ่เกินกำหนด: ") + path);
    return f.readAll();
}
static QJsonObject parse(const QByteArray &bytes) {
    QJsonParseError error; auto d = QJsonDocument::fromJson(bytes, &error);
    if (error.error != QJsonParseError::NoError || !d.isObject()) fail(QStringLiteral("ไฟล์ JSON ไม่สมบูรณ์"));
    auto j = d.object();
    if (j["version"].toInt() != 1 || !j["items"].isArray() || !j["draft"].isObject() || j["items"].toArray().size() > 1000)
        fail(QStringLiteral("รูปแบบหรือเวอร์ชันคลังไม่รองรับ"));
    return j;
}
static void atomic(const QString &path, const QByteArray &bytes) {
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() || !file.commit()) fail(QStringLiteral("บันทึกไฟล์ไม่ได้: ")+path);
}
Store::Store(QString directory) : root(std::move(directory)) {
    if (!QDir().mkpath(root + "/assets")) fail(QStringLiteral("สร้างโฟลเดอร์ข้อมูลไม่ได้"));
}
QJsonObject Store::document() const {
    QJsonArray a; for (const auto &i : items) a.append(i.json());
    return {{"version",1},{"draft",draft.json()},{"items",a},{"hotkeys",hotkeys}};
}
void Store::installDocument(const QJsonObject &j) {
    QVector<Item> next; QSet<QString> ids;
    for (const auto &value : j["items"].toArray()) {
        if (!value.isObject()) fail(QStringLiteral("รายการในคลังไม่สมบูรณ์"));
        auto i = Item::fromJson(value.toObject());
        if (i.id.isEmpty() || ids.contains(i.id)) i.id = QUuid::createUuid().toString(QUuid::WithoutBraces);
        ids.insert(i.id); next.append(i);
    }
    draft = Item::fromJson(j["draft"].toObject()); items = next; hotkeys = j["hotkeys"].toObject();
}
void Store::load() {
    const auto path = root + "/library.json";
    if (!QFile::exists(path) && !QFile::exists(path+".bak")) return;
    try { installDocument(parse(read(path))); }
    catch (const std::exception &) {
        // Preserve the damaged file for inspection before allowing subsequent saves.
        if (QFile::exists(path)) {
            const auto damaged = path + ".damaged-" + QUuid::createUuid().toString(QUuid::WithoutBraces);
            if (!QFile::rename(path, damaged)) fail(QStringLiteral("เก็บไฟล์เสียไม่ได้ จึงหยุดเพื่อรักษาข้อมูลเดิม"));
        }
        try { installDocument(parse(read(path+".bak"))); notice = QStringLiteral("คลังเสียหาย: กู้คืนจากไฟล์สำรองแล้ว (เก็บไฟล์เสียไว้ในโฟลเดอร์ข้อมูล)"); }
        catch (const std::exception &) { notice = QStringLiteral("คลังและไฟล์สำรองอ่านไม่ได้ เริ่มคลังว่างและเก็บไฟล์เดิมไว้แล้ว"); }
    }
}
void Store::save() {
    const auto path = root + "/library.json";
    if (QFile::exists(path)) {
        const auto old = read(path); parse(old); atomic(path+".bak",old);
    }
    atomic(path,QJsonDocument(document()).toJson());
}
QString Store::assetPath(const QString &key) const {
    static const QRegularExpression safe("^[a-f0-9]{64}\\.png$");
    return safe.match(key).hasMatch() ? root+"/assets/"+key : QString();
}
QString Store::addImage(const QString &path) {
    QImageReader reader(path); reader.setAutoTransform(true);
    const auto size = reader.size();
    if (!size.isValid() || qint64(size.width())*size.height() > 40000000) fail(QStringLiteral("รูปไม่รองรับหรือมีขนาดใหญ่เกินไป"));
    if (size.width()>2048 || size.height()>2048) reader.setScaledSize(size.scaled(2048,2048,Qt::KeepAspectRatio));
    auto image = reader.read(); if (image.isNull()) fail(QStringLiteral("เปิดรูปไม่ได้"));
    QByteArray png; QBuffer buffer(&png); buffer.open(QIODevice::WriteOnly);
    if (!image.save(&buffer,"PNG")) fail(QStringLiteral("แปลงรูปไม่ได้"));
    auto key = QString::fromLatin1(QCryptographicHash::hash(png,QCryptographicHash::Sha256).toHex())+".png";
    if (!QFile::exists(assetPath(key))) atomic(assetPath(key),png);
    return key;
}
void Store::exportPackage(const QString &path) const {
    auto j = document(); j.remove("hotkeys"); QJsonObject assets; QSet<QString> keys;
    keys.insert(draft.image); keys.insert(draft.logo);
    for (const auto &i : items) { keys.insert(i.image); keys.insert(i.logo); }
    for (const auto &key : keys) if (!key.isEmpty()) assets[key] = QString::fromLatin1(read(assetPath(key),16*1024*1024).toBase64());
    j["assets"] = assets; auto bytes = QJsonDocument(j).toJson(QJsonDocument::Compact);
    if (bytes.size()>64*1024*1024) fail(QStringLiteral("แพ็กเกจเกิน 64 MB กรุณาลดรูปหรือจำนวนรายการ"));
    atomic(path,bytes);
}
void Store::importPackage(const QString &path) {
    auto j = parse(read(path));
    if (!j["assets"].isObject()) fail(QStringLiteral("แพ็กเกจไม่มีข้อมูลรูปภาพ"));
    QMap<QString,QByteArray> validated;
    const auto assets = j["assets"].toObject();
    for (auto it=assets.begin(); it!=assets.end(); ++it) {
        const auto bytes = QByteArray::fromBase64(it.value().toString().toLatin1(),QByteArray::AbortOnBase64DecodingErrors);
        QBuffer buffer; buffer.setData(bytes); buffer.open(QIODevice::ReadOnly); QImageReader reader(&buffer,"PNG");
        const auto size = reader.size();
        if (assetPath(it.key()).isEmpty() || bytes.size()>16*1024*1024 || !size.isValid() || size.width()>2048 || size.height()>2048 ||
            QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex())+".png"!=it.key() || reader.read().isNull())
            fail(QStringLiteral("รูปภาพในแพ็กเกจไม่ถูกต้อง"));
        validated.insert(it.key(),bytes);
    }
    auto check = [&](const QJsonObject &item) {
        for (const auto &k : {"image","logo"}) {
            auto key=item[k].toString(); if (!key.isEmpty() && !validated.contains(key)) fail(QStringLiteral("แพ็กเกจมีรูปภาพไม่ครบ"));
        }
    };
    check(j["draft"].toObject()); for (const auto &v : j["items"].toArray()) { if (!v.isObject()) fail(QStringLiteral("รายการไม่ถูกต้อง")); check(v.toObject()); }
    for (auto it=validated.begin(); it!=validated.end(); ++it) if (!QFile::exists(assetPath(it.key()))) atomic(assetPath(it.key()),it.value());
    const auto before = document(); j["hotkeys"]=hotkeys;
    try { installDocument(j); save(); } catch (...) { installDocument(before); throw; }
}
Engine::Engine(QString directory,QObject *parent) : QObject(parent),store(std::move(directory)) { store.load(); }
void Engine::air(const Item &item) {
    if (item.type!="logo" && item.line1.trimmed().isEmpty()) {emit problem(QStringLiteral("กรุณากรอกข้อความก่อนขึ้นจอ"));return;}
    if (item.type=="logo" && item.logo.isEmpty() && item.image.isEmpty()) {emit problem(QStringLiteral("กรุณาเลือกโลโก้ก่อนขึ้นจอ"));return;}
    for (const auto &key : {item.image,item.logo}) if (!key.isEmpty() && !QFile::exists(store.assetPath(key))) {emit problem(QStringLiteral("ไฟล์รูปหาย กรุณาเลือกรูปใหม่ก่อนขึ้นจอ"));return;}
    auto &l=layers[size_t(layerFor(item.type))]; l.item=item; l.visible=true; l.started=nowMs(); l.exitStarted=-1;
    l.until=item.duration ? l.started+qint64(item.duration)*1000 : 0; ++revision; emit changed();
}
void Engine::hide(int layer,bool immediate) {
    bool changedAny=false;
    for (size_t n=0;n<layers.size();++n) if ((layer<0 || int(n)==layer) && layers[n].visible) {
        auto &l=layers[n];
        if(immediate || l.item.exitMs==0){l.visible=false;l.exitStarted=-1;changedAny=true;}
        else if(l.exitStarted<0){const auto now=nowMs();l.exitStarted=l.until&&now>=l.until?l.until:now;changedAny=true;}
    }
    if(changedAny){++revision; emit changed();}
}
void Engine::expire() {
    const auto now=nowMs();bool any=false;
    for(auto &l:layers) if(l.visible) {
        if(l.exitStarted<0 && l.until && now>=l.until){l.exitStarted=l.until;any=true;}
        if(l.exitStarted>=0 && now>=l.exitStarted+l.item.exitMs){l.visible=false;any=true;}
    }
    if (any) {++revision;emit changed();}
}
void Engine::persist() { try {store.save();} catch (const std::exception &e) {emit problem(QString::fromUtf8(e.what()));} }
void Engine::publish(QImage image) { QMutexLocker lock(&frameMutex); output=std::move(image); ++outputSerial; }
QImage Engine::frame(quint64 &serial) const { QMutexLocker lock(&frameMutex); serial=outputSerial; return output; }
}
