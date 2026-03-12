import {IResourceClass, IResourceDef} from "./interfaces";
import {ResourceManager} from "./ResourceManager";
import Orm from "./Orm";

declare function makeResourceClass(orm: Orm, resMan: ResourceManager, resourceDef: IResourceDef): IResourceClass;

export { makeResourceClass }