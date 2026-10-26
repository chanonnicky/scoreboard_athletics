#pragma once
#include <QElapsedTimer>
#include <QImage>
#include <QJsonObject>
#include <QMutex>
#include <QObject>
#include <QStringList>
#include <QVector>
#include <array>

namespace cg {
constexpr int Width = 1920, Height = 1080;
QStringList types();
QStringList typeLabels();
QStringList themes();
QStringList themeLabels();
int layerFor(const QString &type);
qint64 nowMs();

struct Item {
    QString id, name = QStringLiteral("รายการใหม่"), type = "name";
    QString line1, line2, label, image, logo;
    QString theme = "default", accent = "#e53935", ink = "auto", background = "solid";
    QString font = "Noto Sans Thai", align = "left", animation = "theme", exitAnimation = "theme";
    int fontSize = 48, x = 96, y = 820, width = 1728, opacity = 100;
    int duration = 0, animMs = 650, exitMs = 420, tickerSec = 28;
    QJsonObject json() const;
    static Item fromJson(const QJsonObject &json);
};
struct Layer {
    Item item;
    bool visible = false;
    qint64 started = 0, until = 0;
    qint64 exitStarted = -1;
};
using Layers = std::array<Layer, 3>;

// Storage contains no on-air state. Assets are content-addressed PNGs owned by this plugin.
class Store {
public:
    explicit Store(QString directory);
    QString root, notice;
    Item draft;
    QVector<Item> items;
    QJsonObject hotkeys;
    void load();
    void save();
    QString addImage(const QString &path);
    QString assetPath(const QString &key) const;
    void exportPackage(const QString &path) const;
    void importPackage(const QString &path);
private:
    QJsonObject document() const;
    void installDocument(const QJsonObject &json);
};

class Engine : public QObject {
    Q_OBJECT
public:
    explicit Engine(QString directory, QObject *parent = nullptr);
    Store store;
    Layers layers;
    quint64 revision = 0;
    void air(const Item &item);
    void hide(int layer = -1, bool immediate = false);
    void expire();
    void persist();
    void publish(QImage image);
    QImage frame(quint64 &serial) const;
signals:
    void changed();
    void problem(const QString &message);
private:
    mutable QMutex frameMutex;
    QImage output;
    quint64 outputSerial = 0;
};
}
