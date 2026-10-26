#pragma once
#include "model.hpp"
#include <QCache>
#include <QPainter>

namespace cg {
QString graphemePrefix(const QString &text, double fraction);
QString themeMotionLabel(const QString &theme);
class Renderer {
public:
    explicit Renderer(const Store &store) : store(store) {}
    void paint(QPainter &painter, const Layers &layers, qint64 now);
    QImage render(const Layers &layers, qint64 now, QSize size = QSize(Width,Height));
    static bool moving(const Layers &layers, qint64 now);
private:
    const Store &store;
    QCache<QString,QImage> cache{48*1024}; // KiB, bounded even for long ticker strings.
    QCache<QString,QImage> images{32*1024};
    const QImage *asset(const QString &key);
    QImage surface(const Item &item, double textProgress);
};
}
