#include "dock.hpp"
#include <QApplication>
#include <QComboBox>
#include <QDir>
#include <QFontDatabase>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPushButton>
#include <QTemporaryDir>
#include <QTabWidget>
#include <QEventLoop>
#include <QTimer>
#include <QScrollArea>
#include <QScrollBar>
#include <iostream>
#include <stdexcept>

static void check(bool value,const char *message){if(!value)throw std::runtime_error(message);}
int main(int argc,char **argv){
    QApplication app(argc,argv);QTemporaryDir temp;
    try{
        QDir fonts(qEnvironmentVariable("CG_FONT_DIR"));for(const auto &file:fonts.entryList({"*.ttf"},QDir::Files))QFontDatabase::addApplicationFont(fonts.filePath(file));
        cg::Engine engine(temp.path());cg::Item seed;seed.id="one";seed.line1=QStringLiteral("สมชาย ใจดี");seed.line2=QStringLiteral("ผู้ดำเนินรายการ");seed.name=QStringLiteral("ตัวอย่างชื่อ–ตำแหน่ง");engine.store.items.append(seed);engine.store.draft=seed;
        int added=0;cg::Dock dock(engine,[&]{++added;});dock.resize(440,1000);dock.show();app.processEvents();
        auto pages=dock.findChild<QTabWidget *>("pages");check(pages&&pages->count()==3&&pages->currentIndex()==0,"live page is default, editor and settings separate");
        auto liveLibrary=dock.findChild<QListWidget *>("liveLibrary");auto draftBefore=engine.store.draft.json();liveLibrary->setCurrentRow(0);check(engine.store.draft.json()==draftBefore&&!engine.layers[0].visible,"selecting live library does not edit or air");
        auto click=[&](const QString &text){for(auto b:dock.findChildren<QPushButton *>())if(b->text()==text){b->click();app.processEvents();return;}throw std::runtime_error("button not found");};
        check(!engine.layers[0].visible,"dock starts hidden");
        click(QStringLiteral("เพิ่มลง Scene ปัจจุบัน"));check(added==1,"source action connected");
        click(QStringLiteral("▶ ขึ้นรายการที่เลือก"));check(engine.layers[0].visible,"air selected item");
        auto quickLine=dock.findChild<QLineEdit *>("quickLine1");check(quickLine!=nullptr,"quick editor available on live page");
        quickLine->setText(QStringLiteral("แก้เร็วโดยไม่สลับหน้า"));check(engine.layers[0].item.line1==seed.line1,"quick edits do not change program until Air");
        click(QStringLiteral("▶ ขึ้นรายการที่เลือก"));check(engine.layers[0].item.line1==quickLine->text(),"Air uses staged quick text");
        check(engine.store.items[0].line1==seed.line1,"quick Air does not silently overwrite library");
        click(QStringLiteral("บันทึกข้อความ"));check(engine.store.items[0].line1==quickLine->text(),"explicit quick save updates library");
        quickLine->setText(seed.line1);click(QStringLiteral("บันทึกข้อความ"));engine.air(seed);
        click(QStringLiteral("ธีม / รูป / รูปแบบ"));check(pages->currentIndex()==1,"design opens editor page");
        QLineEdit *line=nullptr;for(auto edit:dock.findChildren<QLineEdit *>())if(edit->text()==seed.line1)line=edit;
        check(line!=nullptr,"editor found");line->setText(QStringLiteral("ข้อความแก้ไข"));check(engine.layers[0].item.line1==seed.line1,"typing does not mutate program");
        click(QStringLiteral("▶ ขึ้นจอ / อัปเดต"));check(engine.layers[0].item.line1==QStringLiteral("ข้อความแก้ไข"),"explicit update publishes draft");
        click(QStringLiteral("บันทึกคลัง"));check(engine.store.items.size()==1&&engine.store.items[0].line1==engine.store.draft.line1,"save existing item replaces");
        click(QStringLiteral("ทำสำเนา"));check(engine.store.items.size()==2&&engine.store.items[0].id!=engine.store.items[1].id,"duplicate creates unique item");
        auto library=dock.findChild<QListWidget *>("editorLibrary");library->setCurrentRow(1);click(QStringLiteral("↑"));check(library->currentRow()==0,"reorder preserves selection");
        click(QStringLiteral("ลบ"));check(engine.store.items.size()==1,"delete library item");
        QComboBox *type=nullptr;for(auto combo:dock.findChildren<QComboBox *>())if(combo->count()==6&&combo->itemText(0)==cg::typeLabels()[0])type=combo;
        check(type!=nullptr,"type selector found");type->setCurrentIndex(4);check(engine.store.draft.type=="ticker"&&engine.store.draft.y==976,"ticker defaults");type->setCurrentIndex(0);check(engine.store.draft.type=="name"&&engine.store.draft.y==820,"main defaults");
        auto ticker=seed;ticker.type="ticker";engine.air(ticker);click(QStringLiteral("ลงแถบหลัก"));check(engine.layers[0].exitStarted>=0&&engine.layers[1].visible&&engine.layers[1].exitStarted<0,"hide main animates and leaves ticker");
        click(QStringLiteral("■ ลงจอทั้งหมด"));check(engine.layers[1].visible&&engine.layers[1].exitStarted>=0,"hide all animates");
        click(QStringLiteral("ตัดจอทันที (ไม่เล่นแอนิเมชัน)"));check(!engine.layers[1].visible,"emergency cut bypasses animation");
        seed.animMs=0;seed.exitMs=80;engine.air(seed);engine.hide(0);QEventLoop exitLoop;QTimer::singleShot(140,&exitLoop,&QEventLoop::quit);exitLoop.exec();
        check(!engine.layers[0].visible,"Dock timer finishes outgoing animation");quint64 serial=0;auto finalFrame=engine.frame(serial);check(!finalFrame.isNull(),"compositor publishes final hidden frame");
        bool ink=false;for(int y=0;y<finalFrame.height();++y)for(int x=0;x<finalFrame.width();++x)if(finalFrame.constScanLine(y)[x*4+3])ink=true;check(!ink,"no stale graphic after exit ends");
        // Same signal used by OBS when a scene collection is about to change.
        engine.air(seed);engine.hide(-1,true);check(!engine.layers[0].visible,"collection change hides immediately");
        QComboBox *theme=nullptr;for(auto combo:dock.findChildren<QComboBox *>())if(combo->count()==15&&combo->itemText(0)=="Default")theme=combo;
        check(theme!=nullptr,"theme selector found");theme->setCurrentIndex(1);auto liveBefore=engine.layers[0].item.json();
        click(QStringLiteral("ใช้แอนิเมชันตามธีม"));check(engine.store.draft.animation=="theme"&&engine.store.draft.exitAnimation=="theme"&&engine.store.draft.animMs==650&&engine.store.draft.exitMs==420,"one-click themed entry and exit");
        click(QStringLiteral("▷ ทดลองเข้า–ออก (ไม่ขึ้นจอจริง)"));check(engine.layers[0].item.json()==liveBefore&&!engine.layers[0].visible,"animation rehearsal never airs or changes program");
        pages->setCurrentIndex(0);dock.resize(380,740);app.processEvents();
        const auto output=qEnvironmentVariable("CG_TEST_OUTPUT");if(!output.isEmpty()){QDir().mkpath(output);dock.grab().save(output+"/dock.png");}
        pages->setCurrentIndex(1);app.processEvents();for(auto area:dock.findChildren<QScrollArea *>())if(area->isVisible())check(area->horizontalScrollBar()->maximum()==0,"editor fits a narrow dock without horizontal scrolling");
        if(!output.isEmpty())dock.grab().save(output+"/dock-editor.png");
        dock.flush();cg::Store reload(temp.path());reload.load();check(reload.items.size()==1,"dock changes persisted");
        std::cout<<"PASS: Dock draft/update, library CRUD/reorder, layer controls, source callback, persistence\n";return 0;
    }catch(const std::exception &e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}
}
