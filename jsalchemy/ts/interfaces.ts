import {Pager} from "./Pager";
import Collection from "./Collection";
import Orm from "./Orm";
import {ResourceManager} from "./ResourceManager";

export interface IToucher {
    touch:() => void
    touched: boolean
}

export interface IVerb {
    name: string
    isInstance: boolean
    args: Array<string>
    defaults: Array<any>
    detachReturn: boolean
}

export interface IField {
    name: string
    description: string
    type: string
    verbs: Array<IVerb>
    validators: Array<any>
    readonly: boolean
}

export interface IReference {
    description
    resource: string
    type: string
    attibute: string
    foreign_attribute: string
    local_attribute: string
}

export interface IResourceDef {
    $pk: Array<string>
    fields: Array<IField>
    references: Array<IReference>
    format_string?: string
    verbs?: Array<IVerb>
    rpp: number
    [key: string]: any
}

export interface IResource {
    $pk: string
    $row: Object
    $raw: Object
    $dirty: boolean
    $attributeTypes: Object
    $init(a: Object, b? :Object): void
    rpp: number
    // $collection: Collection
    [key: string]: any
}

export interface IResourceClass extends IResource{
    get(...pks: string[]): IResource[]
    getPk(item: IResource | object): string
    getPkFilter(): object
    isComplete(item: IResource): boolean
}


export interface IResourceIndex {
    [Key: string]: IResourceDef
}

export interface ISort {
    totalCount: number;
    isComplete: boolean;
    pagers: Map<string, IPager>;
}

export type FilterFunction = {
    (record: IResource): Boolean
}

export type SortFunction = {
    (rec: IResource, rec: IResource): number
}

export interface IQueryResult {
    pks: string[]
    totalCount: number
}

export interface ICollections {
    [key: string]: Collection
}

export interface IOrmOptions {
    endpoint: string,
    autologin: boolean,
    keepSession: number,
    uiFramework?: 'vue' | 'svelte' | 'react' | 'angular',
    reactiveFunc?: Function,
    ws?: {
        host: string,
        port: number,
        channel: string
    }
}

export type DataPayload = {
  description?: IResourceDef;
  delete?: Record<string, string[]>;
  new?: Record<string, any[]>;
  update?: Record<string, any[]>;
  get?: Record<string, any[]>;
  m2m?: Record<string, any>;
  read?: Record<string, any>;
  payload?: any;
};

export interface IGotDataOptions {
    dontCreate?: boolean;
    savedItems: IResource[]
}

export interface IPaging {
    rpp: number;
    page: number;
    sort: string[];
}

export interface IQueryFilter {
    filter: Record<string, any[]>;
    paging: IPaging;
}Ø

export interface IPager {
    fetch(min: number, max: number): Promise<string[]>;
    remove(pks: string[]): number;
    add(items: IResource[]): void;
    update(items: IResource[]): void;
    hasInterval(min: number, max: number): boolean;
    get(min: number, max: number, callBack?: Function): Promise<string[]>;
    totalCount: number;
    isComplete: boolean;
    sort: string[];
    collection: Collection;
    resMan: ResourceManager;
    filter: Record<string, string[]>
    filterKey: string;
    rpp: number;
}