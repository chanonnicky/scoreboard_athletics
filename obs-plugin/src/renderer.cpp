#include "renderer.hpp"
#include <QFontMetricsF>
#include <QJsonDocument>
#include <QLinearGradient>
#include <QPainterPath>
#include <QTextBoundaryFinder>
#include <cmath>

namespace cg {
QString graphemePrefix(const QString &text,double fraction) {
    if (fraction>=1) return text;
    QTextBoundaryFinder finder(QTextBoundaryFinder::Grapheme,text); QVector<int> ends;
    for (int n=finder.toNextBoundary();n!=-1;n=finder.toNextBoundary()) ends.append(n);
    const int count=int(std::floor(std::clamp(fraction,0.0,1.0)*ends.size()));
    return count ? text.left(ends[count-1]) : QString();
}
const QImage *Renderer::asset(const QString &key) {
    if (key.isEmpty()) return nullptr;
    if (auto found=images.object(key)) return found;
    auto image=new QImage(store.assetPath(key));
    if (image->isNull()) { delete image; return nullptr; }
    const int cost=int(image->sizeInBytes()/1024)+1; images.insert(key,image,cost); return images.object(key);
}
struct Skin { QColor bg, ink, accent, border; int radius=8, shadow=0; };
static Skin skin(const Item &i) {
    Skin s{QColor("#101b2c"),Qt::white,QColor(i.accent),QColor(255,255,255,35),8,0};
    const auto &t=i.theme;
    if(t=="glass") {s.bg=QColor(15,21,33,160);s.border=QColor(255,255,255,110);s.radius=26;}
    else if(t=="clay") {s.bg=QColor("#f5e9e0");s.ink=QColor("#332b42");s.radius=32;s.shadow=12;}
    else if(t=="claydark") {s.bg=QColor("#302e40");s.radius=32;s.shadow=12;}
    else if(t=="neu") {s.bg=QColor("#303640");s.radius=22;s.shadow=8;s.border=QColor("#4b5361");}
    else if(t=="retro") {s.bg=QColor("#200c38");s.accent=QColor("#ff48ce");s.border=QColor("#40e9ff");s.radius=0;}
    else if(t=="editorial") {s.bg=QColor("#f4efe3");s.ink=QColor("#24201e");s.accent=QColor("#8a1f1f");s.border=QColor("#24201e");s.radius=0;}
    else if(t=="broken") {s.bg=QColor("#18203a");s.radius=0;}
    else if(t=="bauhaus") {s.bg=QColor("#f3e7ce");s.ink=Qt::black;s.accent=QColor("#d72e28");s.border=Qt::black;s.radius=0;}
    else if(t=="techno") {s.bg=QColor("#090c0c");s.accent=QColor("#b8ff3b");s.border=QColor("#647d30");s.radius=0;}
    else if(t=="popart") {s.bg=QColor("#fff041");s.ink=Qt::black;s.accent=QColor("#ed2991");s.border=Qt::black;s.radius=0;s.shadow=10;}
    else if(t=="illustrative") {s.bg=QColor("#fff8e7");s.ink=QColor("#39322d");s.border=s.ink;s.radius=18;}
    else if(t=="y2k") {s.bg=QColor("#b8edff");s.ink=QColor("#10306b");s.accent=QColor("#3c78df");s.radius=38;s.border=Qt::white;}
    else if(t=="swiss") {s.bg=QColor("#fafafa");s.ink=Qt::black;s.accent=QColor("#e52324");s.border=Qt::transparent;s.radius=0;}
    else if(t=="pastel") {s.bg=QColor("#f4dfed");s.ink=QColor("#4d435c");s.accent=QColor("#a786bf");s.radius=28;}
    // A changed accent always overrides the theme's suggested accent.
    if(i.accent!="#e53935") s.accent=QColor(i.accent);
    if(i.ink=="light") s.ink=Qt::white; else if(i.ink=="dark") s.ink=QColor("#171717");
    if(i.background=="glass") s.bg.setAlpha(155);
    if(i.background=="none") {s.bg=Qt::transparent;s.border=Qt::transparent;s.shadow=0;}
    return s;
}
static void imageFit(QPainter &p,const QImage *image,QRectF box) {
    if(!image) return;
    auto size=QSizeF(image->size());size.scale(box.size(),Qt::KeepAspectRatio);
    p.drawImage(QRectF(box.center()-QPointF(size.width()/2,size.height()/2),size),*image);
}
static void text(QPainter &p,const QString &value,QRectF box,const Item &i,QColor ink,int pixels,bool bold=false) {
    box=box.adjusted(8,6,-8,-6);if(box.width()<12||box.height()<12)return;
    QFont f(i.font);f.setPixelSize(pixels);f.setBold(bold);
    while(pixels>12){const QFontMetricsF metrics(f);const auto bounds=metrics.boundingRect(value);if(std::max(metrics.horizontalAdvance(value),bounds.width())<=box.width()&&bounds.height()<=box.height())break;f.setPixelSize(--pixels);}
    p.setFont(f);p.setPen(ink);
    const auto clipped=QFontMetricsF(f).elidedText(value,Qt::ElideRight,box.width());
    const auto bounds=QFontMetricsF(f).boundingRect(clipped);
    const qreal left=i.align=="center"?box.center().x()-bounds.width()/2:i.align=="right"?box.right()-bounds.width():box.left();
    p.save();p.setClipRect(box,Qt::IntersectClip);p.drawText(QPointF(left-bounds.left(),box.center().y()-bounds.center().y()),clipped);p.restore();
}
QImage Renderer::surface(const Item &original,double progress) {
    auto i=original;
    i.line1=graphemePrefix(i.line1,progress);i.line2=graphemePrefix(i.line2,progress);
    auto key=QString::fromUtf8(QJsonDocument(i.json()).toJson(QJsonDocument::Compact));
    if(auto found=cache.object(key)) return *found;
    const bool logo=i.type=="logo",ticker=i.type=="ticker";
    const int w=logo?std::min(i.width,512):i.width;
    const int h=logo?w:ticker?std::max(90,i.fontSize+44):std::max(196,i.fontSize*3+56)+(i.type=="strap"&&!i.label.isEmpty()?38:0);
    QImage out(w+28,h+28,QImage::Format_RGBA8888_Premultiplied);out.fill(Qt::transparent);
    QPainter p(&out);p.setRenderHint(QPainter::Antialiasing);p.setRenderHint(QPainter::SmoothPixmapTransform);
    if(logo) {imageFit(p,asset(i.logo.isEmpty()?i.image:i.logo),QRectF(8,8,w,h));}
    else {
        auto s=skin(i);QRectF rect(8,8,w,h);
        if(s.shadow) {p.setPen(Qt::NoPen);p.setBrush(QColor(0,0,0,110));p.drawRoundedRect(rect.translated(s.shadow,s.shadow),s.radius,s.radius);}
        QBrush background(s.bg);
        if(i.background=="grad" || i.theme=="y2k" || i.theme=="glass") {
            QLinearGradient grad(rect.topLeft(),rect.bottomRight());grad.setColorAt(0,s.bg.lighter(135));grad.setColorAt(1,s.bg);background=QBrush(grad);
        }
        p.setBrush(background);p.setPen(QPen(s.border,(i.theme=="popart" || i.theme=="illustrative")?4:1));
        if(i.theme=="broken") {QPolygonF shape;shape<<rect.topLeft()+QPointF(22,0)<<rect.topRight()<<rect.bottomRight()-QPointF(28,0)<<rect.bottomLeft();p.drawPolygon(shape);}
        else p.drawRoundedRect(rect,s.radius,s.radius);
        p.setPen(Qt::NoPen);p.setBrush(s.accent);p.drawRect(QRectF(8,8,10,h));
        if(i.theme=="retro") {p.setPen(QPen(s.border,1));for(int y=h-40;y<h;y+=8)p.drawLine(20,y,w,y);}
        if(i.theme=="techno") {p.setPen(QPen(s.accent,2));for(int x=w-130;x<w-15;x+=14)p.drawLine(x,18,x-12,38);}
        if(i.theme=="bauhaus") {p.setBrush(QColor("#2160ac"));p.drawEllipse(QRectF(w-110,25,70,70));p.setBrush(QColor("#efc42d"));p.drawRect(w-65,h-65,40,40);}
        if(i.theme=="popart") {p.setPen(Qt::NoPen);p.setBrush(QColor(0,0,0,45));for(int x=w-180;x<w-12;x+=16)for(int y=20;y<h;y+=16)p.drawEllipse(QPointF(x,y),2,2);}
        if(i.theme=="illustrative") {p.setPen(QPen(s.accent,3));p.drawLine(35,h-15,w-35,h-19);}
        if(i.theme=="swiss" || i.theme=="editorial") {p.setPen(QPen(s.accent,i.theme=="swiss"?6:2));p.drawLine(30,h-12,w-20,h-12);}
        qreal left=44,right=w-36;
        if(i.type=="nameCard") {imageFit(p,asset(i.image),QRectF(30,24,h-32,h-32));left=h+20;}
        if(!i.logo.isEmpty()) {imageFit(p,asset(i.logo),QRectF(w-h+10,26,h-40,h-40));right=w-h;}
        if(ticker) {
            // Ticker lettering is painted separately so the static panel stays cached.
            if(!i.label.isEmpty()) {p.fillRect(QRectF(18,8,std::min(260,w/3),h),s.accent);Item li=i;li.align="center";text(p,i.label,QRectF(28,8,std::min(240,w/3-20),h),li,Qt::white,std::min(36,i.fontSize),true);}
        } else {
            qreal top=28;
            if(i.type=="strap" && !i.label.isEmpty()) {text(p,i.label,QRectF(left,20,right-left,44),i,s.accent,24,true);top=66;}
            const bool sub=i.type!="topic" && !i.line2.isEmpty();
            const qreal available=h-top-18;
            text(p,i.line1,QRectF(left,top,right-left,sub?available*.56:available),i,s.ink,i.fontSize,true);
            if(sub) text(p,i.line2,QRectF(left,top+available*.56+4,right-left,available*.44-4),i,s.ink,std::max(18,i.fontSize*2/3));
        }
    }
    p.end();cache.insert(key,new QImage(out),int(out.sizeInBytes()/1024)+1);return out;
}
QString themeMotionLabel(const QString &theme) {
    const QStringList labels={
        QStringLiteral("Broadcast · เลื่อนสั้นพร้อมเปิดแถบ"),QStringLiteral("Glass · ลอยนุ่มและแสงสะท้อน"),
        QStringLiteral("Clay · เด้งนุ่ม ยืด–หดเล็กน้อย"),QStringLiteral("Clay Dark · เด้งหนักแน่นและยุบออก"),
        QStringLiteral("Neumorphism · ยกตัวจากพื้นอย่างนุ่มนวล"),QStringLiteral("Retro · เปิดจากกึ่งกลางพร้อมเส้นนีออน"),
        QStringLiteral("Editorial · เปิด–ปิดแบบหน้ากระดาษ"),QStringLiteral("Asymmetrical · เฉือนเปิดแนวทแยง"),
        QStringLiteral("Bauhaus · เปิดเป็นบล็อกเรขาคณิต"),QStringLiteral("Techno · แถบสแกนคมชัด"),
        QStringLiteral("Pop Art · ป๊อปเด้งและเอียงเล็กน้อย"),QStringLiteral("Illustrative · เผยแบบปาดพู่กัน"),
        QStringLiteral("Y2K · ขยายตัวพร้อมแสงเงาวาว"),QStringLiteral("Swiss · เลื่อนและตัดเปิดอย่างแม่นยำ"),
        QStringLiteral("Pastel · ลอยและละลายออกอย่างนุ่มนวล")};
    return labels.value(themes().indexOf(theme),labels[0]);
}
struct ThemePose {
    double dx=0,dy=0,sx=1,sy=1,angle=0,shear=0,alpha=1,reveal=1;
    int mask=0;
};
static double smooth(double t){return t*t*(3-2*t);}
static ThemePose themePose(const QString &theme,double progress,bool entering) {
    // A single normalized timeline drives every transform; no random jitter or flashing.
    const double t=entering?1-std::pow(1-progress,4):1-smooth(progress),h=1-t;
    const double back=entering?1+2.1*std::pow(progress-1,3)+1.1*std::pow(progress-1,2):t;
    ThemePose m;m.alpha=t;m.reveal=t;
    if(theme=="glass"){m.dy=(entering?38:-24)*h;m.sx=m.sy=1-.055*h;}
    else if(theme=="clay"){m.dy=42*(1-back);m.sx=1+.035*std::sin(progress*3.141592653589793)*(entering?1:0);m.sy=.86+.14*back;m.alpha=std::clamp(t*3,0.0,1.0);}
    else if(theme=="claydark"){m.dy=30*(1-back);m.sx=.96+.04*back;m.sy=.90+.10*back;m.alpha=std::clamp(t*2,0.0,1.0);}
    else if(theme=="neu"){m.dy=18*h;m.sx=m.sy=1-.025*h;}
    else if(theme=="retro"){m.sx=1-.08*h;m.sy=1-.12*h;m.mask=2;m.alpha=std::clamp(t*4,0.0,1.0);}
    else if(theme=="editorial"){m.dy=8*h;m.mask=1;m.alpha=1;}
    else if(theme=="broken"){m.dx=(entering?-80:65)*h;m.shear=-.08*h;m.mask=3;m.alpha=std::clamp(t*4,0.0,1.0);}
    else if(theme=="bauhaus"){m.angle=-2*h;m.sx=m.sy=1-.04*h;m.mask=4;m.alpha=1;}
    else if(theme=="techno"){m.dx=(entering?-24:24)*h;m.mask=1;m.alpha=1;}
    else if(theme=="popart"){m.sx=m.sy=.78+.22*back;m.angle=(entering?-4:3)*h;m.alpha=std::clamp(t*4,0.0,1.0);}
    else if(theme=="illustrative"){m.angle=-.8*h;m.mask=6;m.alpha=1;}
    else if(theme=="y2k"){m.dy=30*h;m.sx=.90+.10*back;m.sy=.94+.06*back;}
    else if(theme=="swiss"){m.dx=(entering?-40:40)*h;m.mask=1;m.alpha=1;}
    else if(theme=="pastel"){m.dy=(entering?24:-18)*h;m.sx=m.sy=1-.025*h;m.alpha=smooth(t);}
    else {m.dx=(entering?-56:32)*h;m.mask=1;m.alpha=std::clamp(t*3,0.0,1.0);}
    if(progress==(entering?1:0))return ThemePose{};
    return m;
}
static void applyPose(QPainter &p,const ThemePose &m,QSize size) {
    p.translate(m.dx,m.dy);p.translate(size.width()/2.0,size.height()/2.0);
    p.rotate(m.angle);p.shear(m.shear,0);p.scale(m.sx,m.sy);p.translate(-size.width()/2.0,-size.height()/2.0);
    if(m.mask==0)return;
    const double w=size.width(),h=size.height(),v=std::clamp(m.reveal,0.0,1.0);QPainterPath clip;
    if(m.mask==2)clip.addRect(QRectF(w*(1-v)/2,0,w*v,h));
    else if(m.mask==3){const double edge=(w+h*.45)*v;QPolygonF polygon;polygon<<QPointF(0,0)<<QPointF(edge,0)<<QPointF(edge-h*.45,h)<<QPointF(0,h);clip.addPolygon(polygon);}
    else if(m.mask==4){for(int n=0;n<4;++n){double f=std::clamp(v*1.3-n*.1,0.0,1.0);clip.addRect(QRectF(w*n/4,0,w/4+1,h*f));}}
    else if(m.mask==6){for(int n=0;n<7;++n){double f=std::clamp(v*1.18-(n%3)*.09,0.0,1.0);clip.addRect(QRectF(0,h*n/7,w*f,h/7+1));}}
    else clip.addRect(QRectF(0,0,w*v,h));
    p.setClipPath(clip,Qt::IntersectClip);
}
static void themeHighlight(QPainter &p,const Item &item,const QImage &panel,double phase) {
    if(phase<=0 || phase>=1)return;
    const auto &theme=item.theme;const double intensity=std::sin(phase*3.141592653589793);
    if(theme!="glass"&&theme!="y2k"&&theme!="techno"&&theme!="retro")return;
    const auto size=panel.size();QImage overlay(size,QImage::Format_RGBA8888_Premultiplied);overlay.fill(Qt::transparent);QPainter lightPainter(&overlay);
    if(theme=="glass" || theme=="y2k") {
        const double x=(size.width()+220)*phase-110;QLinearGradient light(x-90,0,x+90,size.height());
        light.setColorAt(0,Qt::transparent);light.setColorAt(.5,QColor(255,255,255,int(65*intensity)));light.setColorAt(1,Qt::transparent);
        lightPainter.fillRect(QRectF(0,0,size.width(),size.height()),light);
    } else if(theme=="techno" || theme=="retro") {
        auto color=skin(item).accent;color.setAlpha(int(180*intensity));lightPainter.setPen(QPen(color,theme=="techno"?3:2));
        if(theme=="techno")lightPainter.drawLine(QPointF(size.width()*phase,8),QPointF(size.width()*phase,size.height()-16));
        else {double r=size.width()*phase/2;lightPainter.drawLine(QPointF(size.width()/2-r,10),QPointF(size.width()/2+r,10));}
    }
    lightPainter.setCompositionMode(QPainter::CompositionMode_DestinationIn);lightPainter.drawImage(0,0,panel);lightPainter.end();p.drawImage(0,0,overlay);
}
bool Renderer::moving(const Layers &layers,qint64 now) {
    for(const auto &l:layers) if(l.visible) {
        const auto exit=l.exitStarted>=0?l.exitStarted:(l.until && now>=l.until?l.until:-1);
        if(exit>=0){if(now<exit+l.item.exitMs)return true;}
        else if(l.item.type=="ticker" || now-l.started<l.item.animMs)return true;
    }
    return false;
}
void Renderer::paint(QPainter &p,const Layers &layers,qint64 now) {
    p.setRenderHint(QPainter::Antialiasing);p.setRenderHint(QPainter::SmoothPixmapTransform);
    for(const auto &l:layers) {
        if(!l.visible) continue;
        const auto &i=l.item;
        const auto exit=l.exitStarted>=0?l.exitStarted:(l.until && now>=l.until?l.until:-1);
        if(exit>=0 && (i.exitMs==0 || now>=exit+i.exitMs))continue;
        const auto entranceTime=exit>=0?std::min(now,exit):now;
        const double progress=i.animMs?std::clamp(double(entranceTime-l.started)/i.animMs,0.0,1.0):1;
        const double out=exit>=0?std::clamp(double(now-exit)/std::max(1,i.exitMs),0.0,1.0):0;
        const double ease=1-std::pow(1-progress,3),outEase=out*out;
        const auto inPose=i.animation=="theme"?themePose(i.theme,progress,true):ThemePose{};
        const auto outPose=i.exitAnimation=="theme"&&exit>=0?themePose(i.theme,out,false):ThemePose{};
        p.save();p.setOpacity(i.opacity/100.0*(i.animation=="fade"?ease:1)*(i.exitAnimation=="fade"?1-outEase:1)*inPose.alpha*outPose.alpha);
        p.translate(i.x,i.y+(i.animation=="slide"?(1-ease)*160:0)+(i.exitAnimation=="slide"?outEase*Height:0));
        const auto panel=surface(i,i.animation=="type"?progress:1);
        applyPose(p,inPose,panel.size());applyPose(p,outPose,panel.size());
        if(i.animation=="wipe") p.setClipRect(QRectF(0,0,panel.width()*ease,panel.height()));
        if(i.exitAnimation=="wipe" && exit>=0)p.setClipRect(QRectF(0,0,panel.width()*(1-outEase),panel.height()),Qt::IntersectClip);
        p.drawImage(0,0,panel);
        if(i.type=="ticker") {
            p.save();
            const auto s=skin(i);const int start=i.label.isEmpty()?30:std::min(260,i.width/3)+30;
            const QRectF area(start+8,20,std::max(1,i.width-start-32),std::max(90,i.fontSize+44)-24);
            p.setClipRect(area,Qt::IntersectClip);QFont f(i.font);int pixels=i.fontSize;f.setPixelSize(pixels);while(pixels>12&&QFontMetricsF(f).height()>area.height()-8)f.setPixelSize(--pixels);p.setFont(f);p.setPen(s.ink);
            const auto value=i.line1.split('\n',Qt::SkipEmptyParts).join(QStringLiteral("     •     "));
            const qreal textWidth=QFontMetricsF(f).horizontalAdvance(value);
            const qreal cycle=textWidth+area.width();
            const qreal x=area.right()-std::fmod(double(std::max(qint64(0),now-l.started))/(i.tickerSec*1000.0),1.0)*cycle;
            p.drawText(QPointF(x,area.center().y()+(QFontMetricsF(f).ascent()-QFontMetricsF(f).descent())/2),value);
            p.restore();
        }
        if(i.animation=="theme")themeHighlight(p,i,panel,progress);
        if(i.exitAnimation=="theme"&&exit>=0)themeHighlight(p,i,panel,1-out);
        p.restore();
    }
}
QImage Renderer::render(const Layers &layers,qint64 now,QSize size) {
    QImage result(size,QImage::Format_RGBA8888_Premultiplied);result.fill(Qt::transparent);QPainter p(&result);
    p.scale(size.width()/double(Width),size.height()/double(Height));paint(p,layers,now);return result;
}
}
