// Metrics and colours from mockup.html / Style.cs

export const Style = {
  CellWidth: 30,
  CellHeight: 32,
  Gap: 4,
  Radius: 5,
  Padding: 18,
  NoteSize: 15,
  LengthSize: 9,
  ControlSize: 11,
  AccidentalGutter: 5,
  AccidentalSize: 15 * 0.62,
  AccidentalRise: 15 * 0.42,
  RailDot: 2,
  RailStep: 7,
  RailOpacity: 0.35,
  LinkOffset: 7.5,
  LinkRadius: 6,
  LatticeDot: 2,

  Background: "#16161a",
  NoteLine: "#e8e8e4",
  NoteText: "#f2f2ee",
  Marker: "#9a9a96",
  Dot: "#4e4e54",
  ControlBackground: "#34343c",
  ControlHover: "#44444e",
  Link: "#86868c",
  Fill: "#6c6c76",
  FillActive: "#84848e",
  Panel: "#1e1e24",
  PanelLine: "#3a3a44",
  Label: "#9a9a96",
  Cursor: "#f2f2ee",
  Playhead: "#f2f2ee",

  get StrideX() {
    return this.CellWidth + this.Gap;
  },
  get StrideY() {
    return this.CellHeight + this.Gap;
  },

  cellOrigin(point) {
    return {
      x: this.Padding + point.x * this.StrideX,
      y: this.Padding + point.y * this.StrideY,
    };
  },

  cellCenter(point) {
    const o = this.cellOrigin(point);
    return { x: o.x + this.CellWidth / 2, y: o.y + this.CellHeight / 2 };
  },

  cellRect(point) {
    const o = this.cellOrigin(point);
    return { x: o.x, y: o.y, w: this.CellWidth, h: this.CellHeight };
  },

  cellAt(position) {
    return {
      x: Math.floor((position.x - this.Padding) / this.StrideX),
      y: Math.floor((position.y - this.Padding) / this.StrideY),
    };
  },

  planeSize(columns, rows) {
    return {
      w: this.Padding * 2 + columns * this.StrideX - this.Gap,
      h: this.Padding * 2 + rows * this.StrideY - this.Gap,
    };
  },
};
