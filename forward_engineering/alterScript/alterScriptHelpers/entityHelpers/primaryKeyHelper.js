const {AlterScriptDto} = require('../../types/AlterScriptDto');
const {
    AlterCollectionDto,
    AlterCollectionColumnDto,
    AlterCollectionRoleCompModPKDto,
    AlterCollectionColumnPrimaryKeyOptionDto
} = require('../../types/AlterCollectionDto');

/**
 * @return {(collection: AlterCollectionDto) => boolean}
 * */
const didCompositePkChange = (_) => (collection) => {
    const pkDto = collection?.role?.compMod?.primaryKey || {};
    const newPrimaryKeys = pkDto.new || [];
    const oldPrimaryKeys = pkDto.old || [];
    if (newPrimaryKeys.length !== oldPrimaryKeys.length) {
        return true;
    }
    if (newPrimaryKeys.length === 0 && oldPrimaryKeys.length === 0) {
        return false;
    }
    const areKeyArraysEqual = _(oldPrimaryKeys).differenceWith(newPrimaryKeys, _.isEqual).isEmpty();
    return !areKeyArraysEqual;
}

/**
 * @param entityName {string}
 * @return {string}
 * */
const getDefaultConstraintName = (entityName) => {
    return `${entityName}_pk`;
}

/**
 * @return {(collection: AlterCollectionDto) => Array<AlterScriptDto>}
 * */
const getAddCompositePkScripts = (_, ddlProvider) => (collection) => {
    // const didPkChange = didCompositePkChange(_)(collection);
    // if (!didPkChange) {
    //     return []
    // }
    // const fullTableName = generateFullEntityName(collection);
    // const constraintName = getEntityNameFromCollection(collection) + '_pk';
    // const pkDto = collection?.role?.compMod?.primaryKey || {};
    // const newPrimaryKeys = pkDto.new || [];
    //
    // return newPrimaryKeys
    //     .map((newPk) => {
    //         /**
    //          * @type {Array<AlterCollectionRoleCompModPKDto>}
    //          * */
    //         const compositePrimaryKey = newPk.compositePrimaryKey || [];
    //         const guidsOfColumnsInPk = compositePrimaryKey.map((compositePkEntry) => compositePkEntry.keyId);
    //         const columnsInPk = getPropertiesByGuids(_)(collection, guidsOfColumnsInPk);
    //         const columnNamesForDDL = columnsInPk.map(column => prepareName(column.compMod.newField.name));
    //         if (!columnNamesForDDL.length) {
    //             return undefined;
    //         }
    //         return ddlProvider.addPkConstraint(fullTableName, constraintName, columnNamesForDDL);
    //     })
    //     .filter(Boolean)
    //     .map(scriptLine => AlterScriptDto.getInstance([scriptLine], collection.isActivated, false))
    //     .filter(Boolean);

    return [];
}

/**
 * @return {(collection: AlterCollectionDto) => Array<AlterScriptDto>}
 * */
const getDropCompositePkScripts = (_, ddlProvider) => (collection) => {
    const {
        getFullCollectionName,
        getSchemaOfAlterCollection,
        getEntityName,
        wrapInQuotes
    } = require('../../../utils/general')(_);

    const didPkChange = didCompositePkChange(_)(collection);
    if (!didPkChange) {
        return [];
    }

    const collectionSchema = getSchemaOfAlterCollection(collection);
    const fullTableName = getFullCollectionName(collectionSchema);
    const entityName = getEntityName(collectionSchema);

    const pkDto = collection?.role?.compMod?.primaryKey || {};
    /**
     * @type {AlterCollectionRoleCompModPKDto[]}
     * */
    const oldPrimaryKeys = pkDto.old || [];

    return oldPrimaryKeys
        .map((oldPk) => {
            let constraintName = getDefaultConstraintName(entityName);
            if (oldPk.constraintName) {
                constraintName = wrapInQuotes(oldPk.constraintName);
            }
            return ddlProvider.dropPkConstraint(fullTableName, constraintName);
        })
        .map(scriptLine => AlterScriptDto.getInstance([scriptLine], collection.isActivated, true))
        .filter(Boolean);
}

/**
 * @return {(collection: AlterCollectionDto) => Array<AlterScriptDto>}
 * */
const getModifyCompositePkScripts = (_, ddlProvider) => (collection) => {
    const dropCompositePkScripts = getDropCompositePkScripts(_, ddlProvider)(collection);
    // const addCompositePkScripts = getAddCompositePkScripts(_, ddlProvider)(collection);

    return [
        ...dropCompositePkScripts,
        // ...addCompositePkScripts,
    ].filter(Boolean);
}

/**
 * @param columnJsonSchema {AlterCollectionColumnDto}
 * @param entityName {string}
 * @return {string}
 * */
const getConstraintNameForRegularPk = (columnJsonSchema, entityName) => {
    const constraintOptions = columnJsonSchema.primaryKeyOptions;
    if (constraintOptions?.length && constraintOptions?.length > 0) {
        /**
         * @type {AlterCollectionColumnPrimaryKeyOptionDto}
         * */
        const constraintOption = constraintOptions[0];
        if (constraintOption.constraintName) {
            return constraintOption.constraintName;
        }
    }
    return getDefaultConstraintName(entityName);
}

/**
 * @param _
 * @param wrapInQuotes {(s: string) => string }
 * @return {(
 *      name: string,
 *      columnJsonSchema: AlterCollectionColumnDto,
 *      entityName: string,
 *      entityJsonSchema: AlterCollectionDto,
 * ) => {
 *         name: string,
 *         keyType: string,
 *         columns: Array<{
 *      		isActivated: boolean,
 *      		name: string,
 *  	   }>,
 *         include: Array<{
 *              isActivated: boolean,
 *              name: string,
 *         }>,
 *         storageParameters: string,
 *         tablespace: string,
 *      }
 *  }
 * */
const getCreateRegularPKDDLProviderConfig = (_, wrapInQuotes) => (
    columnName,
    columnJsonSchema,
    entityName,
    entityJsonSchema
) => {
    const constraintName = getConstraintNameForRegularPk(columnJsonSchema, entityName);
    const pkColumns = [{
        name: wrapInQuotes(columnName),
        isActivated: columnJsonSchema.isActivated,
    }];

    let storageParameters = '';
    let indexTablespace = '';
    let includeColumns = [];
    const constraintOptions = columnJsonSchema.primaryKeyOptions;
    if (constraintOptions?.length && constraintOptions?.length > 0) {
        /**
         * @type {AlterCollectionColumnPrimaryKeyOptionDto}
         * */
        const constraintOption = constraintOptions[0];
        if (constraintOption.indexStorageParameters) {
            storageParameters = constraintOption.indexStorageParameters;
        }
        if (constraintOption.indexTablespace) {
            indexTablespace = constraintOption.indexTablespace;
        }
        if (constraintOption.indexInclude) {
            includeColumns = _.toPairs(entityJsonSchema.properties)
                .filter(([name, jsonSchema]) => Boolean(constraintOption.indexInclude.find(keyDto => keyDto.keyId === jsonSchema.id)))
                .map(([name, jsonSchema]) => ({
                    name,
                    isActivated: jsonSchema.isActivated,
                }));
        }
    }

    return {
        name: constraintName,
        keyType: 'PRIMARY KEY',
        columns: pkColumns,
        include: includeColumns,
        storageParameters,
        tablespace: indexTablespace,
    }
}


/**
 * @return {(collection: AlterCollectionDto) => Array<AlterScriptDto>}
 * */
const getAddPkScripts = (_, ddlProvider) => (collection) => {
    const {
        getFullCollectionName,
        getSchemaOfAlterCollection,
        getEntityName,
        wrapInQuotes
    } = require('../../../utils/general')(_);

    const collectionSchema = getSchemaOfAlterCollection(collection);
    const fullTableName = getFullCollectionName(collectionSchema);
    const entityName = getEntityName(collectionSchema);

    return _.toPairs(collection.properties)
        .filter(([name, jsonSchema]) => {
            const isRegularPrimaryKey = jsonSchema.primaryKey && !jsonSchema.compositePrimaryKey;
            const oldName = jsonSchema.compMod.oldField.name;
            const wasTheFieldAPrimaryKey = Boolean(collection.role.properties[oldName]?.primaryKey);
            return isRegularPrimaryKey && !wasTheFieldAPrimaryKey;
        })
        .map(([name, jsonSchema]) => {
            const ddlConfig = getCreateRegularPKDDLProviderConfig(_, wrapInQuotes)(name, jsonSchema, entityName, collection);
            return ddlProvider.createKeyConstraint(
                fullTableName,
                collection.isActivated,
                ddlConfig
            );
        })
        .map(scriptDto => AlterScriptDto.getInstance([scriptDto.statement], scriptDto.isActivated, false))
        .filter(Boolean);
}

/**
 * @return {(collection: AlterCollectionDto) => Array<AlterScriptDto>}
 * */
const getDropPkScript = (_, ddlProvider) => (collection) => {
    const {
        getFullCollectionName,
        getSchemaOfAlterCollection,
        getEntityName,
        wrapInQuotes
    } = require('../../../utils/general')(_);

    const collectionSchema = getSchemaOfAlterCollection(collection);
    const fullTableName = getFullCollectionName(collectionSchema);
    const entityName = getEntityName(collectionSchema);

    return _.toPairs(collection.properties)
        .filter(([name, jsonSchema]) => {
            const oldName = jsonSchema.compMod.oldField.name;
            const oldJsonSchema = collection.role.properties[oldName];
            const wasTheFieldARegularPrimaryKey = oldJsonSchema?.primaryKey && !oldJsonSchema?.compositePrimaryKey;

            const isNotAPrimaryKey = !jsonSchema.primaryKey && !jsonSchema.compositePrimaryKey;
            return wasTheFieldARegularPrimaryKey && isNotAPrimaryKey;
        })
        .map(([name, jsonSchema]) => {
            const constraintName = wrapInQuotes(getConstraintNameForRegularPk(jsonSchema, entityName));
            return ddlProvider.dropPkConstraint(fullTableName, constraintName);
        })
        .map(scriptLine => AlterScriptDto.getInstance([scriptLine], collection.isActivated, true))
        .filter(Boolean);
}

/**
 * @return {(collection: AlterCollectionDto) => Array<AlterScriptDto>}
 * */
const getModifyPkScripts = (_, ddlProvider) => (collection) => {
    const dropPkScripts = getDropPkScript(_, ddlProvider)(collection);
    const addPkScripts = getAddPkScripts(_, ddlProvider)(collection);

    return [
        ...dropPkScripts,
        ...addPkScripts,
    ].filter(Boolean);
}

/**
 * @return {(collection: AlterCollectionDto) => Array<AlterScriptDto>}
 * */
const getModifyPkConstraintsScriptDtos = (_, ddlProvider) => (collection) => {
    const modifyCompositePkScripts = getModifyCompositePkScripts(_, ddlProvider)(collection);
    const modifyPkScripts = getModifyPkScripts(_, ddlProvider)(collection);

    return [
        ...modifyCompositePkScripts,
        ...modifyPkScripts,
    ].filter(Boolean);
}

module.exports = {
    getModifyPkConstraintsScriptDtos,
}
