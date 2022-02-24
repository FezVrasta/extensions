type Id = string;

export interface Light {
  id: Id;
  name: string;
  state: {
    on: boolean;
    brightness: number;
    xy: [number, number];
    reachable: boolean;
  };
}

export interface Group {
  id: Id;
  name: string;
  lights: Array<Id>;
}
