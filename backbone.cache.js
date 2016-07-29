import Store from 'react-native-simple-store';
import _ from 'underscore';
import async from 'async';

module.exports = function(Backbone) {
    Backbone.Collection.prototype.cacheKey =
    Backbone.Model.prototype.cacheKey = function() {
        // cache key is based on a prefix passed to enableCache, then falls back  to 
        //a global setting on the Backbone object, and then a predefined string
        var prefix = (this._cache_options && this._cache_options.prefix) ||
                     Backbone.CACHE_PREFIX ||
                     "backbone-cache-";
        return prefix + _.result(this, 'url');
    };

    // call this method on a model that should be cached. it's job
    // is a listen for changes on the model and keep the cache up to
    // date with the latest version
    Backbone.Model.prototype.enableCache = function(options) {
        if (this._cache_enabled) return;
        this._cache_enabled = true;
        this._cache_options = options;

        // update cached version of the model any time it's synced from 
        // the server, delaying callback until cache write is completed
        var _fetch = this.fetch;
        this.fetch = function(options) {
            if (!options) options = {};
            var _success = options.success;
            options.success = function() {
                var args = arguments;
                this.cache(function() {
                    if (_success) _success.apply(this, args);
                }.bind(this));
            }.bind(this);
            return _fetch.call(this, options);
        }.bind(this);
        var _save = this.save;
        this.save = function(key, val, options) {
            // Handle both `"key", value` and `{key: value}` -style arguments.
            var attrs;
            if (key == null || typeof key === 'object') {
                attrs = key;
                options = val;
            } else (attrs = {})[key] = val;

            if (!options) options = {};
            var _success = options.success;
            options.success = function() {
                var args = arguments;
                this.cache(function() {
                    if (_success) _success.apply(this, args);
                }.bind(this));
            }.bind(this);
            return _save.call(this, attrs, options);
        }.bind(this);
        var _destroy = this.destroy;
        this.destroy = function(options) {
            if (!options) options = {};
            var _success = options.success;
            options.success = function() {
                var args = arguments;
                this.evictFromCache(function() {
                    if (_success) _success.apply(this, args);
                }.bind(this));
            }.bind(this);
            return _destroy.call(this, options);
        }.bind(this);

        // catch models being removed on sync from collection too
        this.on('destroy remove', function() {
            this.evictFromCache();
        }.bind(this), this);
    };

    // a method to actually do the cache writing
    Backbone.Model.prototype.cache = function(callback) {
        Store.save(this.cacheKey(), this.toJSON()).then(callback);
    };

    Backbone.Model.prototype.evictFromCache = function() {
        this.off(undefined, undefined, this);
        return Store.delete(this.cacheKey());
    };

    Backbone.Model.prototype.restore = function(callback) {
        var model = this;

        // load cached object and inject it into the backbone model
        Store.get(this.cacheKey()).then(function(cached) {
            if (cached) model.set(cached, { silent: false });
            callback();
        }).catch(callback);
    };



    Backbone.Collection.prototype.enableCache = function(options) {
        if (this._cache_enabled) return;
        this._cache_enabled = true;
        this._cache_options = options;
        
        this.models.map(function(model){
            model.enableCache();
        });
        this.on('add', function(model) {
            model.enableCache();
        });

        var _fetch = this.fetch;
        this.fetch = function(options) {
            if (!options) options = {};
            var _success = options.success;
            options.success = function() {
                var args = arguments;
                this.cache(function() {
                    if (_success) _success.apply(this, args);
                }.bind(this));
            }.bind(this);
            return _fetch.call(this, options);
        }.bind(this);
        var _create = this.create;
        this.create = function(model, options) {
            if (!options) options = {};
            var _success = options.success;
            options.success = function() {
                var args = arguments;
                this.cache(function() {
                    if (_success) _success.apply(this, args);
                }.bind(this));
            }.bind(this);
            return _create.call(this, model, options);
        }.bind(this);

    };

    Backbone.Collection.prototype.cache = function(callback) {
        // generate the list of models to be saved as pairs with the 
        // key they should be cached under
        var toCache = this.models.map(function(model){
            return [ model.cacheKey(), model.toJSON() ];
        });
        // and add an entry for the collection which is the list
        // of cache keys that are currently part of this collection
        toCache.push([this.cacheKey(), this.models.map(function(model) {
            return model.cacheKey();
        })]);
        Store.save(toCache).then(function() {
            callback();
        }.bind(this));
    };

    Backbone.Collection.prototype.evictFromCache = function() {
        this.each(function(m){ m.evictFromCache(); });
        return Store.delete(this.cacheKey());
    };

    Backbone.Collection.prototype.restore = function(callback) {
        var collection = this;

        // load saved list of model cachKey()'s, unpack into full models and inject
        // into the backbone collection
        Store.get(this.cacheKey()).then(function(cached) {
            if (!cached) return callback();
            // remove any obviously invalid elements
            cached = _.compact(cached);
            
            Store.get(cached).then(function(values) {
                var models = values.map(function(value) {
                    return new (collection.model)(value);
                });
                collection.set(models, {silent: false});
                callback();
            });
        });
    };
};
