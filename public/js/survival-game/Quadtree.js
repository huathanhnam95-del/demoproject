/**
 * Quadtree.js
 * A simple quadtree for spatial partitioning to optimize collision detection.
 */

export default class Quadtree {
    constructor(bounds, capacity = 10) {
        this.bounds = bounds; // {x, y, width, height}
        this.capacity = capacity;
        this.points = [];
        this.divided = false;
    }

    subdivide() {
        const { x, y, width, height } = this.bounds;
        const w = width / 2;
        const h = height / 2;

        this.nw = new Quadtree({ x: x, y: y, width: w, height: h }, this.capacity);
        this.ne = new Quadtree({ x: x + w, y: y, width: w, height: h }, this.capacity);
        this.sw = new Quadtree({ x: x, y: y + h, width: w, height: h }, this.capacity);
        this.se = new Quadtree({ x: x + w, y: y + h, width: w, height: h }, this.capacity);

        this.divided = true;
    }

    insert(point) {
        if (!this.contains(point)) return false;

        if (this.points.length < this.capacity) {
            this.points.push(point);
            return true;
        }

        if (!this.divided) {
            this.subdivide();
        }

        return (
            this.nw.insert(point) ||
            this.ne.insert(point) ||
            this.sw.insert(point) ||
            this.se.insert(point)
        );
    }

    contains(point) {
        return (
            point.x >= this.bounds.x &&
            point.x < this.bounds.x + this.bounds.width &&
            point.y >= this.bounds.y &&
            point.y < this.bounds.y + this.bounds.height
        );
    }

    query(range, found = []) {
        if (!this.intersects(range)) return found;

        for (let p of this.points) {
            if (this.containsRange(range, p)) {
                found.push(p);
            }
        }

        if (this.divided) {
            this.nw.query(range, found);
            this.ne.query(range, found);
            this.sw.query(range, found);
            this.se.query(range, found);
        }

        return found;
    }

    intersects(range) {
        return !(
            range.x > this.bounds.x + this.bounds.width ||
            range.x + range.width < this.bounds.x ||
            range.y > this.bounds.y + this.bounds.height ||
            range.y + range.height < this.bounds.y
        );
    }

    containsRange(range, point) {
        return (
            point.x >= range.x &&
            point.x < range.x + range.width &&
            point.y >= range.y &&
            point.y < range.y + range.height
        );
    }
}
