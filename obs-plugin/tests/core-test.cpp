#include "model.hpp"
#include "renderer.hpp"
#include <QApplication>
#include <QBuffer>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QFontDatabase>
#include <QJsonArray>
#include <QJsonDocument>
#include <QPainter>
#include <QSet>
#include <QTemporaryDir>
#include <iostream>
#include <stdexcept>

static int checks=0;
static void check(bool condition,const char *message){++checks;if(!condition)throw std::runtime_error(message);}
static void write(const QString &path,const QByteArray &bytes){QFile f(path);if(!f.open(QIODevice::WriteOnly)||f.write(bytes)!=bytes.size())throw std::runtime_error("test file write failed");}
static QByteArray read(const QString &path){QFile f(path);f.open(QIODevice::ReadOnly);return f.readAll();}
template<class F> static void rejects(F action,const char *message){bool caught=false;try{action();}catch(const std::exception &){caught=true;}check(caught,message);}
static bool hasInk(const QImage &image){for(int y=0;y<image.height();++y){auto p=image.constScanLine(y);for(int x=0;x<image.width();++x)if(p[x*4+3])return true;}return false;}
int main(int argc,char **argv){
    QApplication app(argc,argv);QTemporaryDir temp;if(!temp.isValid())return 2;
    try{
        QDir fonts(qEnvironmentVariable("CG_FONT_DIR"));for(const auto &file:fonts.entryList({"*.ttf"},QDir::Files))QFontDatabase::addApplicationFont(fonts.filePath(file));
        cg::Store store(temp.path()+"/one");store.load();check(store.items.isEmpty(),"new library empty");
        cg::Item item;item.id="test";item.line1=QStringLiteral("นายสมชาย ใจดี ผู้ดำเนินรายการ");item.line2=QStringLiteral("ถ่ายทอดสด · งานกีฬาสี");item.label=QStringLiteral("รายงานสด");
        check(cg::Item::fromJson(item.json()).json()==item.json(),"item round trip");
        auto bad=item.json();bad["fontSize"]=-100;bad["width"]=99999;bad["theme"]="unknown";bad["animation"]="unknown";
        auto sanitized=cg::Item::fromJson(bad);check(sanitized.fontSize==18&&sanitized.width==1920&&sanitized.theme=="default"&&sanitized.animation=="slide","input constraints");
        auto thai=QStringLiteral("กิ้");check(cg::graphemePrefix(thai,0.5).isEmpty(),"Thai cluster not split");check(cg::graphemePrefix(thai,1)==thai,"Thai cluster complete");
        auto emoji=QString::fromUtf8("👩‍💻");check(cg::graphemePrefix(emoji,.5).isEmpty(),"emoji cluster not split");
        QImage logo(128,128,QImage::Format_RGBA8888_Premultiplied);logo.fill(Qt::transparent);{QPainter p(&logo);p.setBrush(Qt::red);p.drawEllipse(8,8,112,112);}logo.save(temp.path()+"/logo.png");
        item.image=store.addImage(temp.path()+"/logo.png");item.logo=item.image;
        check(item.image==store.addImage(temp.path()+"/logo.png"),"assets deduplicated");check(store.assetPath("../../outside.png").isEmpty(),"asset traversal blocked");
        store.draft=item;store.items.append(item);store.save();store.draft.name="second";store.save();
        cg::Store restored(store.root);restored.load();check(restored.draft.name=="second"&&restored.items.size()==1,"restore library and draft");
        store.exportPackage(temp.path()+"/package.cglive");cg::Store imported(temp.path()+"/two");imported.importPackage(temp.path()+"/package.cglive");
        check(imported.items.size()==1&&QFile::exists(imported.assetPath(item.image)),"portable package carries assets");
        auto package=QJsonDocument::fromJson(read(temp.path()+"/package.cglive")).object();auto invalid=package;invalid["assets"]=QJsonObject{{"../../escape.png","AAAA"}};
        write(temp.path()+"/invalid.cglive",QJsonDocument(invalid).toJson());auto before=imported.draft.json();
        rejects([&]{imported.importPackage(temp.path()+"/invalid.cglive");},"invalid package rejected");check(before==imported.draft.json(),"failed import keeps library");
        invalid=package;invalid["version"]=99;write(temp.path()+"/invalid.cglive",QJsonDocument(invalid).toJson());rejects([&]{imported.importPackage(temp.path()+"/invalid.cglive");},"future version rejected");
        invalid=package;invalid["assets"]=QJsonObject{};write(temp.path()+"/invalid.cglive",QJsonDocument(invalid).toJson());rejects([&]{imported.importPackage(temp.path()+"/invalid.cglive");},"missing assets rejected");
        write(store.root+"/library.json","broken JSON");cg::Store recovery(store.root);recovery.load();check(recovery.draft.name==item.name&&!recovery.notice.isEmpty(),"backup recovery uses last valid state");recovery.save();
        cg::Engine engine(imported.root);check(!engine.layers[0].visible&&!engine.layers[1].visible&&!engine.layers[2].visible,"restart always hidden");
        engine.air(item);auto program=engine.layers[0].item.json();engine.store.draft.line1="draft only";check(engine.layers[0].item.json()==program,"draft isolated from on-air snapshot");
        auto ticker=item;ticker.type="ticker";ticker.x=0;ticker.y=970;ticker.width=1920;engine.air(ticker);auto bug=item;bug.type="logo";bug.x=1640;bug.y=64;bug.width=180;engine.air(bug);
        check(engine.layers[0].visible&&engine.layers[1].visible&&engine.layers[2].visible,"all three layers coexist");engine.hide(0);check(engine.layers[0].visible&&engine.layers[0].exitStarted>=0&&engine.layers[1].exitStarted<0&&engine.layers[2].exitStarted<0,"hide main animates and preserves other layers");
        const auto exitStarted=engine.layers[0].exitStarted;engine.hide(0);check(engine.layers[0].exitStarted==exitStarted,"repeated hide does not restart exit");
        engine.air(item);check(engine.layers[0].exitStarted<0,"re-air interrupts exit");
        item.duration=1;engine.air(item);engine.layers[0].until=cg::nowMs()-1;engine.expire();check(engine.layers[0].visible&&engine.layers[0].exitStarted>=0,"auto-hide starts exit");
        engine.layers[0].exitStarted=cg::nowMs()-item.exitMs-1;engine.expire();check(!engine.layers[0].visible&&engine.layers[1].visible,"expiry finishes only its layer");
        engine.hide();check(engine.layers[1].exitStarted>=0&&engine.layers[2].exitStarted>=0,"hide all starts exits");engine.hide(-1,true);for(const auto &l:engine.layers)check(!l.visible,"immediate hide all");
        auto empty=item;empty.line1.clear();engine.air(empty);check(!engine.layers[0].visible,"empty text not aired");
        empty=item;empty.image="invalid.png";engine.air(empty);check(!engine.layers[0].visible,"missing image not aired");
        cg::Renderer renderer(imported);QImage sheet(1920,15*210,QImage::Format_RGB32);sheet.fill(QColor("#343840"));QPainter painter(&sheet);QSet<quint64> hashes;
        const auto now=cg::nowMs();int row=0;for(const auto &theme:cg::themes()){
            int col=0;for(const auto &type:cg::types()){
                auto i=item;i.duration=0;i.theme=theme;i.type=type;i.animation="fade";i.animMs=450;
                if(type=="ticker"){i.x=0;i.y=960;i.width=1920;i.line1+=QStringLiteral("\nข้อความถัดไป");}if(type=="logo"){i.x=1640;i.y=64;i.width=180;}
                cg::Layers layers;auto &l=layers[size_t(cg::layerFor(type))];l={i,true,now-1000,0};
                auto image=renderer.render(layers,now,QSize(320,180));check(hasInk(image),"6 types x 15 themes produce visible image");
                for(int y=0;y<image.height();++y){auto pixels=image.constScanLine(y);for(int x=0;x<image.width();++x){auto p=pixels+x*4;check(p[0]<=p[3]&&p[1]<=p[3]&&p[2]<=p[3],"premultiplied alpha channels");}}
                if(type=="name"){quint64 hash=0;for(qsizetype n=0;n<image.sizeInBytes();++n)hash=hash*131+image.constBits()[n];hashes.insert(hash);}
                painter.drawImage(col*320,row*210,image);painter.setPen(Qt::white);painter.drawText(QRect(col*320,row*210+180,320,30),Qt::AlignCenter,theme+" / "+type);++col;
                auto faded=renderer.render(layers,now-1000,QSize(320,180));check(!hasInk(faded),"fade starts transparent");
                layers[size_t(cg::layerFor(type))].until=now;check(!hasInk(renderer.render(layers,now+i.exitMs,QSize(320,180))),"renderer hides expired layer after exit");
            }++row;
        }painter.end();check(hashes.size()==15,"all 15 theme surfaces distinct");
        const QString output=qEnvironmentVariable("CG_TEST_OUTPUT");if(!output.isEmpty()){QDir().mkpath(output);sheet.save(output+"/themes.png");}
        cg::Layers layers;item.duration=0;item.line1=QString(500,QChar(0x0e01));layers[0]={item,true,now-5000,0};layers[1]={ticker,true,now-5000,0};layers[2]={bug,true,now-5000,0};
        check(cg::Renderer::moving(layers,now),"ticker requests frames");renderer.render(layers,now);QElapsedTimer clock;clock.start();for(int n=0;n<120;++n)renderer.render(layers,now+n*16);
        std::cout<<"1080p compositor (3 layers): "<<clock.elapsed()/120.0<<" ms/frame (CPU only, excludes GPU upload)\n";
        for(const auto &animation:QStringList{"slide","fade","wipe","type"}){layers[0].item.animation=animation;layers[0].started=now;for(int offset:{0,100,450,1000})check(renderer.render(layers,now+offset).size()==QSize(1920,1080),"animation samples render");}
        for(const auto &type:cg::types())for(const auto &effect:QStringList{"slide","fade","wipe"}){
            cg::Layers exiting;auto i=item;i.type=type;i.animMs=0;i.exitMs=300;i.exitAnimation=effect;i.x=96;i.y=type=="logo"?64:800;if(type=="logo")i.width=180;
            auto &l=exiting[size_t(cg::layerFor(type))];l={i,true,now-1000,0};l.exitStarted=now;
            const auto full=renderer.render(exiting,now,QSize(320,180)),mid=renderer.render(exiting,now+150,QSize(320,180)),end=renderer.render(exiting,now+300,QSize(320,180));
            check(hasInk(full)&&hasInk(mid)&&!hasInk(end),"each layer has start, middle and end of exit");check(full!=mid,"exit changes rendered pixels");
            check(cg::Renderer::moving(exiting,now+150)&&!cg::Renderer::moving(exiting,now+300),"exit requests frames only while active");
            if(effect=="fade"){quint64 a=0,b=0;for(int y=0;y<full.height();++y)for(int x=0;x<full.width();++x){a+=full.constScanLine(y)[x*4+3];b+=mid.constScanLine(y)[x*4+3];}check(b<a&&b>0,"fade alpha decreases progressively");}
        }
        auto legacy=item.json();legacy.remove("exitMs");legacy.remove("exitAnimation");auto migrated=cg::Item::fromJson(legacy);check(migrated.exitMs==300&&migrated.exitAnimation=="fade","old libraries gain safe exit defaults");
        for(const auto &entry:QStringList{"slide","fade","wipe","type"}){
            cg::Layers early;auto i=item;i.animation=entry;i.animMs=450;i.duration=0;early[0]={i,true,now-100,0};
            const auto beforeExit=renderer.render(early,now,QSize(320,180));early[0].exitStarted=now;
            check(beforeExit==renderer.render(early,now,QSize(320,180)),"hide during entrance does not jump to completed entrance");
        }
        auto instant=item;instant.exitMs=0;engine.air(instant);engine.hide(0);check(!engine.layers[0].visible,"zero exit duration cuts immediately");
        QImage motionSheet(7*320,15*120,QImage::Format_RGB32);motionSheet.fill(QColor("#30343b"));QPainter motionPainter(&motionSheet);
        int themeRow=0;for(const auto &theme:cg::themes()){
            for(const auto &type:cg::types()){
                auto i=item;i.line1=QStringLiteral("กราฟิกสด · CG Live Native");i.line2=QStringLiteral("แอนิเมชันตามธีม");i.type=type;i.theme=theme;i.duration=0;i.animation="theme";i.exitAnimation="theme";i.animMs=650;i.exitMs=420;i.x=96;i.y=800;i.width=1728;
                if(type=="logo"){i.y=64;i.width=180;}
                cg::Layers animated;auto &l=animated[size_t(cg::layerFor(type))];l={i,true,now,0};
                check(!hasInk(renderer.render(animated,now,QSize(320,180))),"themed entrance starts transparent");
                check(hasInk(renderer.render(animated,now+325,QSize(320,180))),"themed entrance has visible intermediate frame");
                const auto settled=renderer.render(animated,now+650,QSize(320,180));l.item.animation="fade";check(settled==renderer.render(animated,now+650,QSize(320,180)),"themed motion settles exactly on static surface");l.item.animation="theme";
                l.exitStarted=now+1000;check(hasInk(renderer.render(animated,now+1210,QSize(320,180))),"themed exit has visible intermediate frame");check(!hasInk(renderer.render(animated,now+1420,QSize(320,180))),"themed exit completes fully transparent");
                l.exitStarted=now+200;auto interrupted=renderer.render(animated,now+200,QSize(320,180));l.exitStarted=-1;check(interrupted==renderer.render(animated,now+200,QSize(320,180)),"themed exit preserves interrupted entrance pose");
                if(type=="name"){
                    l.exitStarted=now+1000;int col=0;for(int t:{100,250,450,650,1080,1210,1340}){const auto frame=renderer.render(animated,now+t);motionPainter.drawImage(QRect(col*320,themeRow*120,320,100),frame,QRect(0,740,1920,340));motionPainter.setPen(Qt::white);motionPainter.drawText(QRect(col*320,themeRow*120+100,320,20),Qt::AlignCenter,theme+" · "+QString::number(t)+"ms");++col;}
                }
            }++themeRow;
        }motionPainter.end();if(!output.isEmpty())motionSheet.save(output+"/theme-motion.png");
        if(!output.isEmpty()){
            QDir().mkpath(output+"/motion-frames");int n=0;
            for(const auto &theme:QStringList{"glass","editorial","techno","popart","bauhaus"})for(int t=0;t<2400;t+=50){
                auto i=item;i.line1=QStringLiteral("CG Live · กราฟิกถ่ายทอดสด");i.line2=QStringLiteral("แอนิเมชันเข้า–ออกตามธีม");i.theme=theme;i.animation="theme";i.exitAnimation="theme";i.animMs=650;i.exitMs=420;i.x=96;i.y=800;i.width=1728;
                cg::Layers animated;animated[0]={i,true,now,now+1500};auto frame=renderer.render(animated,now+t);
                QImage preview(640,180,QImage::Format_RGB32);preview.fill(QColor("#343840"));QPainter p(&preview);p.setPen(Qt::white);QFont f("Noto Sans Thai");f.setPixelSize(18);p.setFont(f);p.drawText(QRect(16,0,608,38),Qt::AlignLeft|Qt::AlignVCenter,cg::themeMotionLabel(theme));p.drawImage(QRect(0,40,640,126),frame,QRect(0,700,1920,378));p.end();preview.save(output+"/motion-frames/"+QString::number(n++).rightJustified(4,'0')+".png");
            }
        }
        QImage typography(960,4*170,QImage::Format_RGB32);typography.fill(QColor("#343840"));QPainter typographyPainter(&typography);int sample=0;
        for(const auto &family:QStringList{"Noto Sans Thai","Charmonman"})for(int pixels:{48,72}){
            auto i=item;i.font=family;i.fontSize=pixels;i.type="name";i.image.clear();i.logo.clear();i.background="none";i.theme="default";i.animation="fade";i.animMs=0;i.opacity=100;i.y=100;i.duration=0;
            i.line1=QStringLiteral("กุ้ง ผู้ชี้แจง น้ำ ฐานญาณ ปี่");i.line2=QStringLiteral("ผู้ดำเนินรายการ · ชื่อและคำบรรยาย");cg::Layers padded;padded[0]={i,true,now-1000,0};const auto frame=renderer.render(padded,now);
            int panelTop=1080,panelBottom=-1,textTop=1080,textBottom=-1,panelLeft=1920,textLeft=1920;
            for(int y=0;y<frame.height();++y)for(int x=0;x<frame.width();++x){const auto c=frame.pixelColor(x,y);if(c.alpha()>50){panelTop=std::min(panelTop,y);panelBottom=std::max(panelBottom,y);panelLeft=std::min(panelLeft,x);if(c.red()>220&&c.green()>220&&c.blue()>220){textTop=std::min(textTop,y);textBottom=std::max(textBottom,y);textLeft=std::min(textLeft,x);}}}
            check(textBottom>=textTop,"Thai ascenders and descenders render in both bundled fonts");check(textTop-panelTop>=16&&panelBottom-textBottom>=16&&textLeft-panelLeft>=24,"Thai text has breathing room inside graphic edges");
            typographyPainter.drawImage(QRect(0,sample*170,960,145),frame,QRect(0,80,1920,290));typographyPainter.setPen(Qt::white);typographyPainter.drawText(QRect(12,sample*170+145,936,25),Qt::AlignLeft|Qt::AlignVCenter,family+" / "+QString::number(pixels)+" px");++sample;
        }typographyPainter.end();if(!output.isEmpty())typography.save(output+"/thai-padding.png");
        engine.publish(renderer.render(layers,now));quint64 serial=0;check(!engine.frame(serial).isNull()&&serial==1,"frame handoff");
        std::cout<<"PASS: "<<checks<<" checks; 90 type/theme combinations\n";return 0;
    }catch(const std::exception &e){std::cerr<<"FAIL after "<<checks<<" checks: "<<e.what()<<'\n';return 1;}
}
