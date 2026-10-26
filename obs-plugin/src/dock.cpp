#include "dock.hpp"
#include <QCheckBox>
#include <QColorDialog>
#include <QComboBox>
#include <QFileDialog>
#include <QFileInfo>
#include <QFontComboBox>
#include <QFormLayout>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMessageBox>
#include <QPainter>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QScrollArea>
#include <QSpinBox>
#include <QTimer>
#include <QTabWidget>
#include <QUuid>
#include <QVBoxLayout>
#include <stdexcept>

namespace cg {
Preview::Preview(Engine &e,Renderer &r,QWidget *parent):QWidget(parent),engine(e),renderer(r) {setMinimumHeight(100);setMaximumHeight(180);setSizePolicy(QSizePolicy::Expanding,QSizePolicy::Preferred);}
void Preview::paintEvent(QPaintEvent *) {
    QPainter p(this);p.fillRect(rect(),QColor("#262930"));
    for(int x=0;x<width();x+=16)for(int y=0;y<height();y+=16)if((x/16+y/16)%2)p.fillRect(x,y,16,16,QColor("#343840"));
    const auto scale=std::min(width()/double(Width),height()/double(Height));
    p.translate((width()-Width*scale)/2,(height()-Height*scale)/2);p.scale(scale,scale);
    p.setClipRect(QRect(0,0,Width,Height));
    if(live)renderer.paint(p,engine.layers,nowMs());
    else {
        Layers draft;auto &l=draft[size_t(layerFor(engine.store.draft.type))];l.item=engine.store.draft;l.visible=true;l.started=started;
        if(demoStarted>=0){l.started=demoStarted;l.until=demoStarted+l.item.animMs+900;if(nowMs()>l.until+l.item.exitMs+500){demoStarted=-1;started=nowMs()-l.item.animMs;l.started=started;l.until=0;}}
        renderer.paint(p,draft,nowMs());
    }
}
static QPushButton *button(const QString &label,QBoxLayout *layout,const std::function<void()> &action) {
    auto b=new QPushButton(label);b->setMinimumHeight(34);layout->addWidget(b);QObject::connect(b,&QPushButton::clicked,b,action);return b;
}
Dock::Dock(Engine &e,std::function<void()> addSource,QWidget *parent):QWidget(parent),engine(e),renderer(e.store) {
    setObjectName("cgDock");setMinimumWidth(300);
    setStyleSheet("QWidget#cgDock QLineEdit, QWidget#cgDock QPlainTextEdit { padding:7px 10px; min-height:22px; border-radius:5px; }"
                  "QWidget#cgDock QPushButton { padding:7px 9px; border-radius:5px; background:palette(button); color:palette(button-text); border:1px solid palette(mid); }"
                  "QWidget#cgDock QPushButton:hover { background:palette(midlight); }"
                  "QWidget#cgDock QPushButton:disabled { color:palette(mid); }"
                  "QWidget#cgDock QComboBox, QWidget#cgDock QSpinBox { padding:6px 9px; min-height:22px; }"
                  "QWidget#cgDock QListWidget::item { padding:7px 10px; }"
                  "QWidget#cgDock QTabBar::tab { padding:8px 10px; }");
    auto outer=new QVBoxLayout(this);outer->setContentsMargins(8,8,8,8);outer->setSpacing(8);
    warning=new QLabel;warning->setWordWrap(true);warning->setTextInteractionFlags(Qt::TextSelectableByMouse);warning->setStyleSheet("color:#ffbd69;");outer->addWidget(warning);warning->hide();
    pages=new QTabWidget;pages->setObjectName("pages");pages->setDocumentMode(true);outer->addWidget(pages);
    auto stopRow=new QHBoxLayout;outer->addLayout(stopRow);
    auto stop=button(QStringLiteral("■ ลงจอทั้งหมด"),stopRow,[this]{engine.hide();});stop->setStyleSheet("background:#782727;color:white;");
    auto livePage=new QWidget;auto live=new QVBoxLayout(livePage);pages->addTab(livePage,QStringLiteral("ใช้งาน"));
    live->setContentsMargins(0,8,0,0);live->setSpacing(8);
    status=new QLabel;status->setWordWrap(true);live->addWidget(status);
    auto monitorToggle=new QPushButton(QStringLiteral("ดูภาพออกอากาศ / ลงรายชั้น ▾"));monitorToggle->setCheckable(true);live->addWidget(monitorToggle);
    auto monitor=new QWidget;auto monitorLayout=new QVBoxLayout(monitor);monitorLayout->setContentsMargins(0,0,0,0);live->addWidget(monitor);monitor->hide();
    connect(monitorToggle,&QPushButton::toggled,monitor,&QWidget::setVisible);
    programPreview=new Preview(engine,renderer);programPreview->live=true;programPreview->setMaximumHeight(120);monitorLayout->addWidget(programPreview);
    auto hides=new QHBoxLayout;monitorLayout->addLayout(hides);
    button(QStringLiteral("ลงแถบหลัก"),hides,[this]{engine.hide(0);});button(QStringLiteral("ลงแถบวิ่ง"),hides,[this]{engine.hide(1);});button(QStringLiteral("ลงโลโก้"),hides,[this]{engine.hide(2);});
    auto libraryHeading=new QHBoxLayout;live->addLayout(libraryHeading);libraryHeading->addWidget(new QLabel(QStringLiteral("1 · เลือกชิ้นงาน")),1);
    button(QStringLiteral("＋ สร้างรายการ"),libraryHeading,[this]{engine.store.draft=Item{};populate();collect();library->clearSelection();pages->setCurrentIndex(1);});
    search=new QLineEdit;search->setClearButtonEnabled(true);search->setPlaceholderText(QStringLiteral("ค้นหาชื่อหรือข้อความ…"));live->addWidget(search);
    emptyLibrary=new QLabel(QStringLiteral("ยังไม่มีชิ้นงาน\nกด ＋ สร้างรายการ เพื่อเริ่มต้น"));emptyLibrary->setWordWrap(true);emptyLibrary->setAlignment(Qt::AlignCenter);live->addWidget(emptyLibrary);
    liveLibrary=new QListWidget;liveLibrary->setObjectName("liveLibrary");liveLibrary->setMinimumHeight(110);live->addWidget(liveLibrary,1);
    quickCard=new QGroupBox(QStringLiteral("2 · แก้ข้อความก่อนขึ้นจอ"));auto quick=new QFormLayout(quickCard);quick->setRowWrapPolicy(QFormLayout::WrapAllRows);quick->setFieldGrowthPolicy(QFormLayout::AllNonFixedFieldsGrow);live->addWidget(quickCard);
    quickSummary=new QLabel;quickSummary->setWordWrap(true);quick->addRow(quickSummary);
    quickLine1=new QLineEdit;quickLine1->setObjectName("quickLine1");quickLine1->setMaxLength(8000);quickLine1->setPlaceholderText(QStringLiteral("ชื่อ / หัวข้อ"));quick->addRow(quickLine1);
    quickLine2=new QLineEdit;quickLine2->setObjectName("quickLine2");quickLine2->setMaxLength(2000);quickLine2->setPlaceholderText(QStringLiteral("ตำแหน่ง / คำบรรยาย"));quick->addRow(quickLine2);
    quickMessages=new QPlainTextEdit;quickMessages->setMaximumHeight(85);quickMessages->setPlaceholderText(QStringLiteral("ข้อความวิ่ง บรรทัดละหนึ่งข้อความ"));quick->addRow(quickMessages);
    auto quickTools=new QHBoxLayout;quick->addRow(quickTools);
    saveQuick=button(QStringLiteral("บันทึกข้อความ"),quickTools,[this]{saveQuickText();});saveQuick->setEnabled(false);
    button(QStringLiteral("ธีม / รูป / รูปแบบ"),quickTools,[this]{const int n=liveLibrary->currentRow();if(n<0)return;collectQuick();library->setCurrentRow(n);engine.store.draft=liveDraft;populate();pages->setCurrentIndex(1);});
    auto liveActions=new QHBoxLayout;live->addLayout(liveActions);
    airSelected=button(QStringLiteral("▶ ขึ้นรายการที่เลือก"),liveActions,[this]{const int n=liveLibrary->currentRow();if(n>=0&&!liveLibrary->item(n)->isHidden()){collectQuick();engine.air(liveDraft);}});
    airSelected->setMinimumHeight(46);airSelected->setStyleSheet("background:#216e42;color:white;font-weight:bold;");
    hideSelected=button(QStringLiteral("ลงจอ"),liveActions,[this]{if(liveLibrary->currentItem())engine.hide(layerFor(liveDraft.type));});hideSelected->setMinimumHeight(46);
    connect(quickLine1,&QLineEdit::textChanged,this,[this]{collectQuick();});connect(quickLine2,&QLineEdit::textChanged,this,[this]{collectQuick();});connect(quickMessages,&QPlainTextEdit::textChanged,this,[this]{collectQuick();});
    connect(search,&QLineEdit::textChanged,this,[this]{filterLiveLibrary();});
    connect(liveLibrary,&QListWidget::currentRowChanged,this,[this]{if(!loading){selectLiveItem();filterLiveLibrary();}});
    // A double-click selects only. The green button is the single explicit Air action.
    auto scroll=new QScrollArea;scroll->setWidgetResizable(true);pages->addTab(scroll,QStringLiteral("ออกแบบ"));
    auto body=new QWidget;auto layout=new QVBoxLayout(body);layout->setSizeConstraint(QLayout::SetNoConstraint);body->setSizePolicy(QSizePolicy::Ignored,QSizePolicy::Preferred);scroll->setWidget(body);
    layout->addWidget(new QLabel(QStringLiteral("PREVIEW · ฉบับร่าง (ยังไม่เปลี่ยนภาพออกอากาศ)")));
    preview=new Preview(engine,renderer);layout->addWidget(preview);
    auto demoActions=new QVBoxLayout;layout->addLayout(demoActions);
    button(QStringLiteral("▷ ทดลองเข้า–ออก (ไม่ขึ้นจอจริง)"),demoActions,[this]{preview->demoStarted=nowMs();preview->update();});
    auto actions=new QVBoxLayout;layout->addLayout(actions);
    button(QStringLiteral("บันทึกคลัง"),actions,[this]{saveItem(false);pages->setCurrentIndex(0);});
    auto air=button(QStringLiteral("▶ ขึ้นจอ / อัปเดต"),actions,[this]{airDraft();});air->setStyleSheet("background:#216e42;color:white;font-weight:bold;");
    auto editor=new QGroupBox(QStringLiteral("แก้ไขฉบับร่าง"));layout->addWidget(editor);form=new QFormLayout(editor);
    form->setRowWrapPolicy(QFormLayout::WrapAllRows);form->setFieldGrowthPolicy(QFormLayout::AllNonFixedFieldsGrow);form->setSizeConstraint(QLayout::SetNoConstraint);
    name=new QLineEdit;name->setMaxLength(120);form->addRow(QStringLiteral("ชื่อรายการในคลัง"),name);
    type=new QComboBox;type->addItems(typeLabels());form->addRow(QStringLiteral("ประเภท"),type);
    line1=new QLineEdit;line1->setMaxLength(8000);form->addRow(QStringLiteral("ชื่อ / หัวข้อ"),line1);
    line2=new QLineEdit;line2->setMaxLength(2000);form->addRow(QStringLiteral("ตำแหน่ง / คำบรรยาย"),line2);
    label=new QLineEdit;label->setMaxLength(120);form->addRow(QStringLiteral("ป้ายหมวด"),label);
    messages=new QPlainTextEdit;messages->setMaximumHeight(100);messages->setPlaceholderText(QStringLiteral("ข้อความวิ่ง บรรทัดละหนึ่งข้อความ"));form->addRow(QStringLiteral("ข้อความวิ่ง"),messages);
    auto imageRow=new QWidget;auto imageLayout=new QHBoxLayout(imageRow);imageLayout->setContentsMargins(0,0,0,0);imageName=new QLabel;imageLayout->addWidget(imageName);
    button(QStringLiteral("เลือกรูป"),imageLayout,[this]{pickImage(false);});button(QStringLiteral("ล้าง"),imageLayout,[this]{engine.store.draft.image.clear();populate();collect();});form->addRow(QStringLiteral("รูปประกอบ"),imageRow);
    auto logoRow=new QWidget;auto logoLayout=new QHBoxLayout(logoRow);logoLayout->setContentsMargins(0,0,0,0);logoName=new QLabel;logoLayout->addWidget(logoName);
    button(QStringLiteral("เลือกโลโก้"),logoLayout,[this]{pickImage(true);});button(QStringLiteral("ล้าง"),logoLayout,[this]{engine.store.draft.logo.clear();populate();collect();});form->addRow(QStringLiteral("โลโก้"),logoRow);
    theme=new QComboBox;theme->addItems(themeLabels());form->addRow(QStringLiteral("ธีม"),theme);
    motionHint=new QLabel;motionHint->setWordWrap(true);form->addRow(motionHint);
    auto themeMotion=new QPushButton(QStringLiteral("ใช้แอนิเมชันตามธีม"));themeMotion->setMinimumHeight(34);form->addRow(themeMotion);
    connect(themeMotion,&QPushButton::clicked,this,[this]{loading=true;animation->setCurrentIndex(0);exitAnimation->setCurrentIndex(0);animMs->setValue(650);exitMs->setValue(420);loading=false;collect();preview->demoStarted=nowMs();});
    auto colorRow=new QWidget;auto colorLayout=new QHBoxLayout(colorRow);colorLayout->setContentsMargins(0,0,0,0);accent=new QLineEdit;accent->setMaxLength(7);colorLayout->addWidget(accent);
    button(QStringLiteral("เลือกสี"),colorLayout,[this]{const auto c=QColorDialog::getColor(QColor(accent->text()),this,QStringLiteral("สีเน้น"));if(c.isValid())accent->setText(c.name());});form->addRow(QStringLiteral("สีเน้น"),colorRow);
    ink=new QComboBox;ink->addItems({QStringLiteral("ตามธีม"),QStringLiteral("สว่าง"),QStringLiteral("เข้ม")});form->addRow(QStringLiteral("สีตัวอักษร"),ink);
    background=new QComboBox;background->addItems({QStringLiteral("ตามธีม"),QStringLiteral("ไล่สี"),QStringLiteral("กระจกโปร่งใส"),QStringLiteral("ไม่มีพื้น")});form->addRow(QStringLiteral("พื้นหลัง"),background);
    font=new QFontComboBox;form->addRow(QStringLiteral("ฟอนต์"),font);
    align=new QComboBox;align->addItems({QStringLiteral("ซ้าย"),QStringLiteral("กลาง"),QStringLiteral("ขวา")});form->addRow(QStringLiteral("จัดแนว"),align);
    animation=new QComboBox;animation->addItems({QStringLiteral("ตามธีม (แนะนำ)"),QStringLiteral("เลื่อน"),QStringLiteral("จาง"),QStringLiteral("ปาด"),QStringLiteral("พิมพ์ทีละตัว")});form->addRow(QStringLiteral("แอนิเมชันเข้า"),animation);
    exitAnimation=new QComboBox;exitAnimation->addItems({QStringLiteral("ตามธีม (แนะนำ)"),QStringLiteral("เลื่อนลง"),QStringLiteral("จางออก"),QStringLiteral("ปาดออก")});form->addRow(QStringLiteral("แอนิเมชันออก"),exitAnimation);
    auto spin=[&](const QString &title,int min,int max){auto s=new QSpinBox;s->setRange(min,max);form->addRow(title,s);return s;};
    fontSize=spin(QStringLiteral("ขนาดตัวอักษร (px)"),18,120);x=spin(QStringLiteral("ตำแหน่ง X"),0,1800);y=spin(QStringLiteral("ตำแหน่ง Y"),0,1040);
    width=spin(QStringLiteral("ความกว้าง"),120,1920);opacity=spin(QStringLiteral("ความทึบ (%)"),0,100);duration=spin(QStringLiteral("ลงจออัตโนมัติ (วินาที, 0=ไม่ตั้ง)"),0,86400);
    animMs=spin(QStringLiteral("เวลาเข้า (ms)"),0,3000);exitMs=spin(QStringLiteral("เวลาออก (ms)"),0,3000);tickerSec=spin(QStringLiteral("แถบวิ่ง วินาที/รอบ"),2,300);
    auto more=new QPushButton(QStringLiteral("รูปลักษณ์ / แอนิเมชัน / เวลา"));more->setCheckable(true);form->addRow(more);
    connect(more,&QPushButton::toggled,this,[this](bool checked){advanced=checked;setFields();});
    auto libBox=new QGroupBox(QStringLiteral("จัดการคลังรายการ"));auto libLayout=new QVBoxLayout(libBox);
    library=new QListWidget;library->setObjectName("editorLibrary");library->setMinimumHeight(170);libLayout->addWidget(library);
    auto libActions=new QHBoxLayout;libLayout->addLayout(libActions);
    button(QStringLiteral("ใหม่"),libActions,[this]{engine.store.draft=Item{};populate();collect();library->clearSelection();});
    button(QStringLiteral("ทำสำเนา"),libActions,[this]{saveItem(true);});
    button(QStringLiteral("ลบ"),libActions,[this]{int n=library->currentRow();if(n<0)return;engine.store.items.removeAt(n);engine.store.draft.id.clear();refreshLibrary();engine.persist();});
    button(QStringLiteral("↑"),libActions,[this]{moveItem(-1);});button(QStringLiteral("↓"),libActions,[this]{moveItem(1);});
    auto settingsScroll=new QScrollArea;settingsScroll->setWidgetResizable(true);pages->addTab(settingsScroll,QStringLiteral("ตั้งค่า"));
    auto settings=new QWidget;settingsScroll->setWidget(settings);auto settingsLayout=new QVBoxLayout(settings);settingsLayout->setSizeConstraint(QLayout::SetNoConstraint);settings->setSizePolicy(QSizePolicy::Ignored,QSizePolicy::Preferred);
    button(QStringLiteral("เพิ่มลง Scene ปัจจุบัน"),settingsLayout,addSource);
    settingsLayout->addWidget(libBox);
    button(QStringLiteral("ตัดจอทันที (ไม่เล่นแอนิเมชัน)"),settingsLayout,[this]{engine.hide(-1,true);});
    button(QStringLiteral("ส่งออกคลังพร้อมรูป (.cglive)"),settingsLayout,[this]{auto path=QFileDialog::getSaveFileName(this,QStringLiteral("ส่งออกคลัง"),"cg-live.cglive","CG Live (*.cglive)");if(!path.isEmpty())attempt([&]{collect();engine.store.exportPackage(path);});});
    button(QStringLiteral("นำเข้าคลังพร้อมรูป (แทนที่คลังปัจจุบัน)"),settingsLayout,[this]{
        auto path=QFileDialog::getOpenFileName(this,QStringLiteral("นำเข้าคลัง"),{},"CG Live (*.cglive)");if(path.isEmpty())return;
        if(QMessageBox::question(this,QStringLiteral("นำเข้าคลัง"),QStringLiteral("แทนที่คลังและฉบับร่างปัจจุบัน? ไฟล์เดิมจะมีสำรองไว้"))!=QMessageBox::Yes)return;
        attempt([&]{saveTimer->stop();engine.store.importPackage(path);engine.hide(-1,true);populate();refreshLibrary();});
    });
    auto help=new QLabel(QStringLiteral("คลังกลางใช้ร่วมกันทุก Scene Collection\nHotkey ตั้งได้ที่ OBS → Settings → Hotkeys → CG Live\nGlass ไม่เบลอภาพกล้องด้านหลัง\nพื้นที่ออกแบบ 1920×1080 · ปรับสเกลที่ Source\nข้อมูล: ")+engine.store.root);help->setWordWrap(true);help->setTextInteractionFlags(Qt::TextSelectableByMouse);settingsLayout->addWidget(help);
    settingsLayout->addStretch();
    layout->addStretch();
    saveTimer=new QTimer(this);saveTimer->setSingleShot(true);saveTimer->setInterval(500);connect(saveTimer,&QTimer::timeout,this,[this]{engine.persist();});
    for(auto w:{name,line1,line2,label,accent})connect(w,&QLineEdit::textChanged,this,[this]{collect();});
    connect(messages,&QPlainTextEdit::textChanged,this,[this]{collect();});
    for(auto w:{theme,ink,background,align,animation,exitAnimation})connect(w,&QComboBox::currentIndexChanged,this,[this]{collect();});
    connect(font,&QFontComboBox::currentFontChanged,this,[this]{collect();});
    for(auto w:{fontSize,x,y,width,opacity,duration,animMs,exitMs,tickerSec})connect(w,&QSpinBox::valueChanged,this,[this]{collect();});
    connect(type,&QComboBox::currentIndexChanged,this,[this]{
        if(loading)return;auto &i=engine.store.draft;const auto t=types().value(type->currentIndex(),"name");
        if(t=="logo"){x->setValue(1630);y->setValue(64);width->setValue(180);}else if(t=="ticker"){x->setValue(0);y->setValue(976);width->setValue(1920);}else if(layerFor(i.type)!=0){x->setValue(96);y->setValue(820);width->setValue(1728);}
        collect();setFields();
    });
    connect(library,&QListWidget::currentRowChanged,this,[this](int n){if(loading||n<0||n>=engine.store.items.size())return;engine.store.draft=engine.store.items[n];populate();saveTimer->start();});
    connect(library,&QListWidget::itemDoubleClicked,this,[this](QListWidgetItem *){airIndex(library->currentRow());});
    connect(&engine,&Engine::changed,this,[this]{refreshStatus();refreshLibrary();});
    connect(&engine,&Engine::problem,this,[this](const QString &m){report(m);});
    auto timer=new QTimer(this);timer->setTimerType(Qt::PreciseTimer);timer->setInterval(16);
    connect(timer,&QTimer::timeout,this,[this]{
        engine.expire();const auto now=nowMs();const bool moving=Renderer::moving(engine.layers,now);
        if(renderedRevision!=engine.revision||moving||wasMoving){engine.publish(renderer.render(engine.layers,now));renderedRevision=engine.revision;}
        wasMoving=moving;if(isVisible()){preview->update();programPreview->update();}
    });timer->start();
    auto clock=new QTimer(this);clock->setInterval(250);connect(clock,&QTimer::timeout,this,[this]{refreshStatus();});clock->start();
    populate();refreshLibrary();refreshStatus();if(!engine.store.notice.isEmpty())report(engine.store.notice);
}
void Dock::report(const QString &m){warning->setText(m);warning->show();}
void Dock::attempt(const std::function<void()> &action){try{action();}catch(const std::exception &e){report(QString::fromUtf8(e.what()));}}
void Dock::collect(){
    if(loading)return;auto &i=engine.store.draft;i.name=name->text();i.type=types().value(type->currentIndex(),"name");
    i.line1=i.type=="ticker"?messages->toPlainText().left(8000):line1->text();i.line2=line2->text();i.label=label->text();
    i.theme=themes().value(theme->currentIndex(),"default");if(QColor(accent->text()).isValid())i.accent=QColor(accent->text()).name();
    i.ink=QStringList{"auto","light","dark"}.value(ink->currentIndex());i.background=QStringList{"solid","grad","glass","none"}.value(background->currentIndex());
    i.align=QStringList{"left","center","right"}.value(align->currentIndex());i.animation=QStringList{"theme","slide","fade","wipe","type"}.value(animation->currentIndex());i.font=font->currentFont().family();
    i.exitAnimation=QStringList{"theme","slide","fade","wipe"}.value(exitAnimation->currentIndex());i.exitMs=exitMs->value();
    i.fontSize=fontSize->value();i.x=x->value();i.y=y->value();i.width=width->value();i.opacity=opacity->value();i.duration=duration->value();i.animMs=animMs->value();i.tickerSec=tickerSec->value();
    motionHint->setText(themeMotionLabel(i.theme));preview->demoStarted=-1;preview->started=nowMs();preview->update();saveTimer->start();
}
void Dock::populate(){
    loading=true;const auto &i=engine.store.draft;name->setText(i.name);type->setCurrentIndex(types().indexOf(i.type));line1->setText(i.line1);line2->setText(i.line2);label->setText(i.label);messages->setPlainText(i.line1);
    theme->setCurrentIndex(themes().indexOf(i.theme));accent->setText(i.accent);ink->setCurrentIndex(QStringList{"auto","light","dark"}.indexOf(i.ink));background->setCurrentIndex(QStringList{"solid","grad","glass","none"}.indexOf(i.background));
    align->setCurrentIndex(QStringList{"left","center","right"}.indexOf(i.align));animation->setCurrentIndex(QStringList{"theme","slide","fade","wipe","type"}.indexOf(i.animation));font->setCurrentFont(QFont(i.font));
    exitAnimation->setCurrentIndex(QStringList{"theme","slide","fade","wipe"}.indexOf(i.exitAnimation));exitMs->setValue(i.exitMs);
    fontSize->setValue(i.fontSize);x->setValue(i.x);y->setValue(i.y);width->setValue(i.width);opacity->setValue(i.opacity);duration->setValue(i.duration);animMs->setValue(i.animMs);tickerSec->setValue(i.tickerSec);
    auto assetStatus=[this](const QString &key){return key.isEmpty()?QStringLiteral("ไม่มี"):QFileInfo::exists(engine.store.assetPath(key))?QStringLiteral("พร้อมใช้"):QStringLiteral("⚠ ไฟล์หาย");};
    imageName->setText(assetStatus(i.image));logoName->setText(assetStatus(i.logo));motionHint->setText(themeMotionLabel(i.theme));loading=false;setFields();preview->demoStarted=-1;preview->started=nowMs();preview->update();
}
void Dock::setFields(){
    const auto &t=engine.store.draft.type;auto show=[this](QWidget *w,bool yes){form->setRowVisible(w,yes);};
    show(line1,t!="logo"&&t!="ticker");show(line2,t=="name"||t=="nameCard"||t=="strap");show(label,t=="strap"||t=="ticker");show(messages,t=="ticker");
    show(imageName->parentWidget(),t=="nameCard");
    for(QWidget *w:QList<QWidget *>{ink,background,font,align,animation,exitAnimation,fontSize,x,y,width,opacity,duration,animMs,exitMs})show(w,advanced);
    show(tickerSec,t=="ticker"&&advanced);
}
void Dock::pickImage(bool isLogo){auto path=QFileDialog::getOpenFileName(this,QStringLiteral("เลือกรูป"),{},"Images (*.png *.jpg *.jpeg *.webp *.bmp)");if(path.isEmpty())return;attempt([&]{auto key=engine.store.addImage(path);if(isLogo)engine.store.draft.logo=key;else engine.store.draft.image=key;populate();collect();});}
void Dock::saveItem(bool copy){
    collect();auto &i=engine.store.draft;if(copy||i.id.isEmpty())i.id=QUuid::createUuid().toString(QUuid::WithoutBraces);
    if(copy)i.name+=QStringLiteral(" (สำเนา)");
    bool found=false;for(auto &item:engine.store.items)if(item.id==i.id){item=i;found=true;break;}
    if(!found){if(engine.store.items.size()>=1000){report(QStringLiteral("คลังรองรับสูงสุด 1,000 รายการ"));return;}engine.store.items.append(i);}
    liveDraft=i;populate();refreshLibrary();for(int n=0;n<engine.store.items.size();++n)if(engine.store.items[n].id==i.id)liveLibrary->setCurrentRow(n);selectLiveItem();engine.persist();
}
void Dock::moveItem(int delta){int n=library->currentRow(),other=n+delta;if(n<0||other<0||other>=engine.store.items.size())return;engine.store.items.swapItemsAt(n,other);refreshLibrary();library->setCurrentRow(other);engine.persist();}
void Dock::refreshLibrary(){
    loading=true;const auto selected=library->currentRow()>=0?library->currentItem()->data(Qt::UserRole).toString():QString();library->clear();
    const auto selectedLive=liveLibrary->currentItem()?liveLibrary->currentItem()->data(Qt::UserRole).toString():QString();liveLibrary->clear();
    for(int n=0;n<engine.store.items.size();++n){const auto &i=engine.store.items[n];bool live=false,leaving=false;for(const auto &l:engine.layers)if(l.visible&&!i.id.isEmpty()&&l.item.id==i.id){live=true;leaving=l.exitStarted>=0;}
        const auto badge=leaving?QStringLiteral("↘ กำลังลง · "):live?QStringLiteral("● ออกจอ · "):QString();
        auto row=new QListWidgetItem(badge+QString::number(n+1)+" · "+i.name,library);row->setData(Qt::UserRole,i.id);if(live)row->setForeground(QColor("#57d993"));if(i.id==selected)library->setCurrentRow(n);
        auto runtimeRow=new QListWidgetItem(badge+QString::number(n+1)+" · "+i.name+"\n"+i.line1.left(100).replace('\n', ' '),liveLibrary);
        runtimeRow->setData(Qt::UserRole,i.id);runtimeRow->setSizeHint(QSize(0,58));if(live)runtimeRow->setForeground(QColor(leaving?"#ffbd69":"#57d993"));if(i.id==selectedLive)liveLibrary->setCurrentRow(n);
    }if(selectedLive.isEmpty()&&liveLibrary->count())liveLibrary->setCurrentRow(0);loading=false;selectLiveItem();filterLiveLibrary();
}
void Dock::selectLiveItem(){
    const int n=liveLibrary->currentRow();const bool valid=n>=0&&n<engine.store.items.size();quickCard->setEnabled(valid);hideSelected->setEnabled(valid);
    if(!valid){quickSummary->setText(QStringLiteral("เลือกชิ้นงานจากคลังด้านบน"));return;}
    const auto &saved=engine.store.items[n];if(liveDraft.id!=saved.id)liveDraft=saved;
    loadingQuick=true;quickLine1->setText(liveDraft.line1);quickLine2->setText(liveDraft.line2);quickMessages->setPlainText(liveDraft.line1);loadingQuick=false;
    quickLine1->setVisible(liveDraft.type!="ticker"&&liveDraft.type!="logo");quickMessages->setVisible(liveDraft.type=="ticker");quickLine2->setVisible(liveDraft.type=="name"||liveDraft.type=="nameCard"||liveDraft.type=="strap");
    quickSummary->setText(liveDraft.name+" · "+themeLabels().value(themes().indexOf(liveDraft.theme)));
    const QStringList layers{QStringLiteral("ลงแถบหลัก"),QStringLiteral("ลงแถบวิ่ง"),QStringLiteral("ลงโลโก้")};hideSelected->setText(layers[layerFor(liveDraft.type)]);
    saveQuick->setEnabled(liveDraft.line1!=saved.line1||liveDraft.line2!=saved.line2);
}
void Dock::collectQuick(){
    if(loadingQuick||loading)return;const int n=liveLibrary->currentRow();if(n<0||n>=engine.store.items.size())return;
    if(liveDraft.type!="logo")liveDraft.line1=liveDraft.type=="ticker"?quickMessages->toPlainText().left(8000):quickLine1->text();liveDraft.line2=quickLine2->text();
    const auto &saved=engine.store.items[n];saveQuick->setEnabled(liveDraft.line1!=saved.line1||liveDraft.line2!=saved.line2);
}
void Dock::saveQuickText(){
    collectQuick();for(auto &item:engine.store.items)if(item.id==liveDraft.id){item.line1=liveDraft.line1;item.line2=liveDraft.line2;break;}
    engine.persist();refreshLibrary();
}
void Dock::filterLiveLibrary(){
    const auto query=search->text().trimmed();for(int n=0;n<liveLibrary->count();++n)liveLibrary->item(n)->setHidden(!liveLibrary->item(n)->text().contains(query,Qt::CaseInsensitive));
    const auto selected=liveLibrary->currentItem();const bool ready=selected&&!selected->isHidden();airSelected->setEnabled(ready);quickCard->setEnabled(ready);hideSelected->setEnabled(ready);
    emptyLibrary->setVisible(engine.store.items.isEmpty());
    liveLibrary->setToolTip(engine.store.items.isEmpty()?QStringLiteral("กด ＋ สร้างรายการ เพื่อเตรียมกราฟิกชิ้นแรก"):QString());
}
void Dock::refreshStatus(){QStringList lines,active;const QStringList names{QStringLiteral("แถบหลัก"),QStringLiteral("แถบวิ่ง"),QStringLiteral("โลโก้")};for(size_t n=0;n<3;++n){const auto &l=engine.layers[n];QString s=names[int(n)]+": "+(l.visible?(l.exitStarted>=0?QStringLiteral("↘ กำลังลง · "):QStringLiteral("● "))+l.item.name:QStringLiteral("ซ่อน"));if(l.visible){active<<names[int(n)]+(l.exitStarted>=0?QStringLiteral(" (กำลังลง)"):QString());}if(l.visible&&l.until&&l.exitStarted<0)s+=" ("+QString::number(std::max(qint64(0),(l.until-nowMs()+999)/1000))+QStringLiteral(" วินาที)");lines<<s;}status->setText(active.isEmpty()?QStringLiteral("○ ยังไม่มีกราฟิกออกอากาศ"):QStringLiteral("● ออกอากาศ · ")+active.join(" / "));status->setToolTip(lines.join('\n'));}
void Dock::airDraft(){collect();engine.air(engine.store.draft);}
void Dock::airIndex(int index){if(index>=0&&index<engine.store.items.size())engine.air(engine.store.items[index]);}
void Dock::flush(){saveTimer->stop();engine.persist();}
}
