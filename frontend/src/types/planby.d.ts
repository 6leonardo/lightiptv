declare module 'planby' {
  import type * as React from 'react';

  export const Epg: React.ComponentType<any>;
  export const Layout: React.ComponentType<any>;
  export const ChannelBox: React.ComponentType<any>;
  export const ChannelLogo: React.ComponentType<any>;
  export const ProgramBox: React.ComponentType<any>;
  export const ProgramContent: React.ComponentType<any>;
  export const ProgramFlex: React.ComponentType<any>;
  export const ProgramStack: React.ComponentType<any>;
  export const ProgramTitle: React.ComponentType<any>;
  export const ProgramText: React.ComponentType<any>;
  export const ProgramImage: React.ComponentType<any>;
  export const TimelineWrapper: React.ComponentType<any>;
  export const TimelineBox: React.ComponentType<any>;
  export const TimelineTime: React.ComponentType<any>;
  export const TimelineDivider: React.ComponentType<any>;
  export const TimelineDividers: React.ComponentType<any>;

  export function useEpg(options: any): any;
  export function useProgram(options: any): any;
  export function useTimeline(numberOfHoursInDay: number, isBaseTimeFormat: boolean): any;
}
