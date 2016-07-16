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
        // the server
        this.on('sync', function() {
            this.cache();
        }.bind(this));
    };

    // a method to actually do the cache writing
    Backbone.Model.prototype.cache = function() {
        return Store.save(this.cacheKey(), this.toJSON());
    };

    Backbone.Model.prototype.evictFromCache = function() {
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
        
        // when any model in the collection changes, re-cache it
        this.on('sync', function() {
            this.cache();
        }.bind(this));

        this.on('add', function(model) {
            model.cache();
            this.cache();
        }.bind(this));

        // tidy up models that aren't required any longer
        // todo: this will go wrong if a model is in multiple collections!
        //       maybe need some sort of reference counting?
        this.on('remove', function(model) {
            model.evictFromCache();
        }.bind(this));
    };

    Backbone.Collection.prototype.cache = function() {
        return Store.save(this.cacheKey(), this.map(function(m) { return m.id; }));
    };

    Backbone.Collection.prototype.evictFromCache = function() {
        this.each(function(m){ m.evictFromCache(); });
        return Store.delete(this.cacheKey());
    };

    Backbone.Collection.prototype.restore = function(callback) {
        var collection = this;
        // load cached IDs, unpack into full models and inject
        // into the backbone collection
        Store.get(this.cacheKey()).then(function(cached) {
            if (!cached) return callback();
            // remove any obviously invalid elements
            cached = _.compact(cached);
            
            async.map(cached, function(id, cb){
                var doc = {};
                doc[collection.model.prototype.idAttribute] = id;
                var model = new (collection.model)(doc);
                model.collection = collection;
                model.restore(function() {
                    cb(false, model);
                });
            }, function(err, models){
                if (models) collection.set(models, {silent: false});
                callback(err);
            });
        }).catch(callback);
    };
};
