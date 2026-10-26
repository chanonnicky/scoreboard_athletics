#pragma once
#include "model.hpp"
#include "renderer.hpp"
#include <QWidget>
#include <functional>

class QComboBox;
class QLineEdit;
class QPlainTextEdit;
class QSpinBox;
class QFontComboBox;
class QListWidget;
class QLabel;
class QTimer;
class QFormLayout;
class QTabWidget;
class QPushButton;
class QGroupBox;
namespace cg {
class Preview : public QWidget {
public:
    Preview(Engine &engine,Renderer &renderer,QWidget *parent=nullptr);
    bool live=false;
    qint64 started=nowMs();
    qint64 demoStarted=-1;
protected:
    void paintEvent(QPaintEvent *) override;
private:
    Engine &engine;
    Renderer &renderer;
};
class Dock : public QWidget {
public:
    Dock(Engine &engine,std::function<void()> addSource,QWidget *parent=nullptr);
    void airDraft();
    void airIndex(int index);
    void flush();
private:
    Engine &engine;
    Renderer renderer;
    Preview *preview,*programPreview;
    QTabWidget *pages;
    QComboBox *type,*theme,*ink,*background,*align,*animation,*exitAnimation;
    QLineEdit *name,*line1,*line2,*label,*accent;
    QPlainTextEdit *messages;
    QFontComboBox *font;
    QSpinBox *fontSize,*x,*y,*width,*opacity,*duration,*animMs,*exitMs,*tickerSec;
    QListWidget *library,*liveLibrary;
    QLineEdit *search;
    QPushButton *airSelected;
    QPushButton *hideSelected,*saveQuick;
    QGroupBox *quickCard;
    QLineEdit *quickLine1,*quickLine2;
    QPlainTextEdit *quickMessages;
    QLabel *quickSummary,*emptyLibrary;
    Item liveDraft;
    bool loadingQuick=false;
    QLabel *status,*warning,*imageName,*logoName,*motionHint;
    QTimer *saveTimer;
    QFormLayout *form;
    bool loading=false;
    bool advanced=false;
    quint64 renderedRevision=~quint64(0);
    bool wasMoving=false;
    void collect();
    void populate();
    void refreshLibrary();
    void refreshStatus();
    void filterLiveLibrary();
    void selectLiveItem();
    void collectQuick();
    void saveQuickText();
    void setFields();
    void pickImage(bool logo);
    void saveItem(bool copy);
    void moveItem(int delta);
    void report(const QString &message);
    void attempt(const std::function<void()> &action);
};
}
