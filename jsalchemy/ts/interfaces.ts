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
    pagers: Map<string, Pager>
}

export type FilterFunction = {
    (record: IResource): Boolean
}

export type SortFunction = {
    (record: IResource): number
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
  payload?: any;
};

